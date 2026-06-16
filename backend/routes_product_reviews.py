import io
import re
from collections import defaultdict
from typing import List

import pandas as pd
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

import models
from deps import get_db
from services import clear_runtime_caches, get_product_ids_for_pois, normalize_float_cell, normalize_string_cell


router = APIRouter()

REVIEW_PRODUCT_ID_PATTERN = re.compile(r"mt-comments-(?P<product_id>\d+)", re.IGNORECASE)
REQUIRED_REVIEW_COLUMNS = ["评价时间", "评分", "评价内容", "评价产品"]


def extract_product_id_from_filename(filename):
    match = REVIEW_PRODUCT_ID_PATTERN.search(filename or "")
    return match.group("product_id") if match else ""


def parse_review_time(value):
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.to_pydatetime()


def find_product_for_review_file(db, filename, review_product_names):
    candidate_id = extract_product_id_from_filename(filename)
    if candidate_id:
        product = db.get(models.Product, candidate_id)
        if product is not None:
            return product, "filename_id"

    cleaned_names = list(dict.fromkeys(
        normalize_string_cell(name)
        for name in review_product_names
        if normalize_string_cell(name)
    ))
    if not cleaned_names:
        return None, "missing_review_product"

    product = db.query(models.Product).filter(models.Product.name.in_(cleaned_names)).first()
    if product is not None:
        return product, "exact_name"

    normalized_targets = {name.replace(" ", "") for name in cleaned_names}
    for product in db.query(models.Product).all():
        if normalize_string_cell(product.name).replace(" ", "") in normalized_targets:
            return product, "normalized_name"

    return None, "unmatched"


def parse_review_excel(file_bytes, filename):
    try:
        dataframe = pd.read_excel(io.BytesIO(file_bytes))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"{filename} 读取失败：{exc}") from exc

    missing_columns = [
        column_name
        for column_name in REQUIRED_REVIEW_COLUMNS
        if column_name not in dataframe.columns
    ]
    if missing_columns:
        raise HTTPException(
            status_code=400,
            detail=f"{filename} 缺少必要列：{', '.join(missing_columns)}",
        )

    return dataframe


@router.post("/product_reviews/upload")
async def upload_product_reviews(
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一个评价文件")

    file_results = []
    review_mappings_by_product = defaultdict(list)

    for file in files:
        file_bytes = await file.read()
        try:
            dataframe = parse_review_excel(file_bytes, file.filename)
            product, match_method = find_product_for_review_file(
                db,
                file.filename,
                dataframe["评价产品"].dropna().tolist(),
            )
            if product is None:
                file_results.append({
                    "filename": file.filename,
                    "status": "unmatched",
                    "message": "没有匹配到数据库里的商品",
                    "review_count": 0,
                })
                continue

            parsed_count = 0
            skipped_count = 0
            for _, row in dataframe.iterrows():
                review_time = parse_review_time(row.get("评价时间"))
                rating = normalize_float_cell(row.get("评分"))
                source_product_name = normalize_string_cell(row.get("评价产品"))
                content = normalize_string_cell(row.get("评价内容"))

                if review_time is None or rating <= 0:
                    skipped_count += 1
                    continue

                review_mappings_by_product[product.id].append({
                    "product_id": product.id,
                    "product_name": product.name,
                    "review_time": review_time,
                    "rating": rating,
                    "content": content,
                    "source_product_name": source_product_name,
                    "source_file": file.filename,
                })
                parsed_count += 1

            file_results.append({
                "filename": file.filename,
                "status": "success",
                "product_id": product.id,
                "product_name": product.name,
                "match_method": match_method,
                "review_count": parsed_count,
                "skipped_count": skipped_count,
            })
        except HTTPException as exc:
            file_results.append({
                "filename": file.filename,
                "status": "failed",
                "message": exc.detail,
                "review_count": 0,
            })
        except Exception as exc:
            file_results.append({
                "filename": file.filename,
                "status": "failed",
                "message": str(exc),
                "review_count": 0,
            })

    product_ids = list(review_mappings_by_product)
    inserted_count = sum(len(rows) for rows in review_mappings_by_product.values())
    replaced_product_count = len(product_ids)

    if product_ids:
        db.query(models.ProductReview).filter(
            models.ProductReview.product_id.in_(product_ids)
        ).delete(synchronize_session=False)

        for rows in review_mappings_by_product.values():
            if rows:
                db.bulk_insert_mappings(models.ProductReview, rows)

    db.commit()
    clear_runtime_caches()

    success_count = sum(1 for result in file_results if result["status"] == "success")
    unmatched_count = sum(1 for result in file_results if result["status"] == "unmatched")
    failed_count = sum(1 for result in file_results if result["status"] == "failed")

    return {
        "message": f"评价上传完成：成功 {success_count} 个文件，未匹配 {unmatched_count} 个，失败 {failed_count} 个",
        "success_count": success_count,
        "unmatched_count": unmatched_count,
        "failed_count": failed_count,
        "inserted_count": inserted_count,
        "replaced_product_count": replaced_product_count,
        "results": file_results,
    }


@router.get("/product_reviews")
def get_product_reviews(
    mode: str = "product",
    productId: str = None,
    poiName: str = None,
    db: Session = Depends(get_db),
):
    if mode not in {"product", "poi"}:
        raise HTTPException(status_code=400, detail="mode must be product or poi")

    product_ids = []
    scope_label = ""
    if mode == "poi":
        if not poiName:
            raise HTTPException(status_code=400, detail="poiName is required")
        product_ids = get_product_ids_for_pois(db, [poiName])
        scope_label = poiName
    else:
        if not productId:
            raise HTTPException(status_code=400, detail="productId is required")
        product = db.get(models.Product, productId)
        if product is None:
            raise HTTPException(status_code=404, detail="Product not found")
        product_ids = [product.id]
        scope_label = product.name

    if not product_ids:
        return {
            "mode": mode,
            "scope_label": scope_label,
            "rows": [],
            "trend": [],
            "summary": {
                "review_count": 0,
                "average_rating": 0,
                "product_count": 0,
            },
        }

    reviews = db.query(models.ProductReview).filter(
        models.ProductReview.product_id.in_(product_ids)
    ).order_by(
        models.ProductReview.review_time.desc(),
        models.ProductReview.id.desc(),
    ).all()

    rows = [
        {
            "id": review.id,
            "product_id": review.product_id,
            "product_name": review.product_name,
            "review_time": review.review_time.strftime("%Y-%m-%d %H:%M") if review.review_time else "",
            "review_date": review.review_time.strftime("%Y-%m-%d") if review.review_time else "",
            "rating": float(review.rating or 0),
            "content": review.content or "",
        }
        for review in reviews
    ]

    trend_buckets = defaultdict(list)
    for review in reviews:
        if review.review_time:
            trend_buckets[review.review_time.strftime("%Y-%m-%d")].append(float(review.rating or 0))

    trend = [
        {
            "date": date_key,
            "average_rating": sum(values) / len(values) if values else 0,
            "review_count": len(values),
        }
        for date_key, values in sorted(trend_buckets.items())
    ]

    ratings = [float(review.rating or 0) for review in reviews if review.rating]
    average_rating = sum(ratings) / len(ratings) if ratings else 0
    product_count = len({review.product_id for review in reviews})

    return {
        "mode": mode,
        "scope_label": scope_label,
        "rows": rows,
        "trend": trend,
        "summary": {
            "review_count": len(rows),
            "average_rating": average_rating,
            "product_count": product_count,
        },
    }

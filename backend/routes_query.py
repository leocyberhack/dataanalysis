from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from deps import get_db
from services import (
    PRODUCT_INDEX,
    apply_product_filter,
    build_summary_payload,
    build_summary_rankings,
    get_cached_response,
    get_pois,
    parse_poi_names,
    parse_product_ids,
)


router = APIRouter()


@router.get("/dates")
def get_dates(db: Session = Depends(get_db)):
    dates = db.query(models.DailySummary.date).order_by(models.DailySummary.date.desc()).all()
    return {"dates": [d[0].strftime("%Y-%m-%d") for d in dates]}


@router.get("/date_status")
def get_date_status(db: Session = Depends(get_db)):
    results = db.query(models.DailySummary).order_by(models.DailySummary.date.desc()).all()
    return {
        row.date.strftime("%Y-%m-%d"): {
            "commodity": bool(row.commodity_uploaded),
            "order": bool(row.order_uploaded),
        }
        for row in results
    }


@router.get("/products")
def get_products(startDate: str = None, endDate: str = None, db: Session = Depends(get_db)):
    if startDate and endDate:
        try:
            start = datetime.strptime(startDate, "%Y-%m-%d").date()
            end = datetime.strptime(endDate, "%Y-%m-%d").date()
            return PRODUCT_INDEX.get_products(db, start, end)
        except ValueError:
            pass
    return PRODUCT_INDEX.get_products(db)


@router.get("/pois")
def get_poi_options(startDate: str = None, endDate: str = None, db: Session = Depends(get_db)):
    if startDate and endDate:
        try:
            start = datetime.strptime(startDate, "%Y-%m-%d").date()
            end = datetime.strptime(endDate, "%Y-%m-%d").date()
            return get_pois(db, start, end)
        except ValueError:
            pass
    return get_pois(db)


@router.get("/summary")
def get_summary(
    date: str = None,
    startDate: str = None,
    endDate: str = None,
    productIds: str = None,
    poiNames: str = None,
    db: Session = Depends(get_db),
):
    if date and not startDate:
        startDate = date
    if date and not endDate:
        endDate = date

    try:
        start_dt = datetime.strptime(startDate, "%Y-%m-%d").date()
        end_dt = datetime.strptime(endDate, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid date format")

    parsed_product_ids = parse_product_ids(productIds)
    parsed_poi_names = parse_poi_names(poiNames)
    if parsed_product_ids and parsed_poi_names:
        raise HTTPException(status_code=400, detail="Product and POI filters cannot be combined")

    return get_cached_response(
        "summary",
        (start_dt, end_dt, tuple(parsed_product_ids), tuple(parsed_poi_names)),
        lambda: build_summary_payload(
            db=db,
            start_date=start_dt,
            end_date=end_dt,
            product_ids=parsed_product_ids,
            poi_names=parsed_poi_names,
        ),
    )


@router.get("/summary/rankings")
def get_summary_rankings(
    startDate: str,
    endDate: str = None,
    db: Session = Depends(get_db),
):
    try:
        start_dt = datetime.strptime(startDate, "%Y-%m-%d").date()
        end_dt = datetime.strptime(endDate or startDate, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid date format")

    return get_cached_response(
        "summary_rankings",
        (start_dt, end_dt),
        lambda: build_summary_rankings(db, start_dt, end_dt),
    )


@router.get("/data")
def get_data(
    startDate: str,
    endDate: str,
    productIds: str = None,
    limit: int = None,
    offset: int = None,
    fields: str = None,
    includeTotal: bool = False,
    db: Session = Depends(get_db),
):
    try:
        start = datetime.strptime(startDate, "%Y-%m-%d").date()
        end = datetime.strptime(endDate, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid dates")

    parsed_product_ids = parse_product_ids(productIds)
    advanced_response = fields is not None or limit is not None or offset not in (None, 0) or includeTotal

    if limit is not None and limit <= 0:
        raise HTTPException(status_code=400, detail="limit must be greater than 0")
    if offset is not None and offset < 0:
        raise HTTPException(status_code=400, detail="offset cannot be negative")

    if not advanced_response:
        query = db.query(models.DailyData, models.Product.name.label("product_name"))\
            .join(models.Product, models.DailyData.product_id == models.Product.id)\
            .filter(models.DailyData.date >= start, models.DailyData.date <= end)

        query = apply_product_filter(query, parsed_product_ids)

        results = query.all()

        out = []
        for r, pname in results:
            row_dict = {c.name: getattr(r, c.name) for c in r.__table__.columns}
            row_dict["product_name"] = pname
            row_dict["date"] = row_dict["date"].strftime("%Y-%m-%d")
            out.append(row_dict)

        return out

    data_columns = {column.name: getattr(models.DailyData, column.name) for column in models.DailyData.__table__.columns}
    allowed_fields = set(data_columns) | {"product_name"}
    if fields:
        selected_fields = [item.strip() for item in fields.split(",") if item.strip()]
    else:
        selected_fields = [*data_columns.keys(), "product_name"]
    if not selected_fields:
        raise HTTPException(status_code=400, detail="At least one field is required")

    invalid_fields = [field for field in selected_fields if field not in allowed_fields]
    if invalid_fields:
        raise HTTPException(status_code=400, detail=f"Invalid fields: {', '.join(invalid_fields)}")

    selected_columns = [
        models.Product.name.label("product_name") if field == "product_name" else data_columns[field]
        for field in selected_fields
    ]

    query = db.query(*selected_columns)\
        .select_from(models.DailyData)\
        .join(models.Product, models.DailyData.product_id == models.Product.id)\
        .filter(models.DailyData.date >= start, models.DailyData.date <= end)
    query = apply_product_filter(query, parsed_product_ids)

    total = None
    if includeTotal:
        count_query = db.query(func.count(models.DailyData.id)).filter(
            models.DailyData.date >= start,
            models.DailyData.date <= end,
        )
        count_query = apply_product_filter(count_query, parsed_product_ids)
        total = count_query.scalar() or 0

    query = query.order_by(models.DailyData.date.desc(), models.DailyData.product_id.asc())
    offset_value = offset or 0
    if offset_value:
        query = query.offset(offset_value)
    if limit is not None:
        query = query.limit(min(limit, 5000))

    rows = []
    for row in query.all():
        row_dict = dict(row._mapping)
        if "date" in row_dict and row_dict["date"] is not None:
            row_dict["date"] = row_dict["date"].strftime("%Y-%m-%d")
        rows.append(row_dict)

    return {
        "rows": rows,
        "total": total,
        "limit": min(limit, 5000) if limit is not None else None,
        "offset": offset_value,
        "fields": selected_fields,
    }

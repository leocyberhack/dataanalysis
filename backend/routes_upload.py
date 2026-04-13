import io
from collections import defaultdict
from datetime import datetime

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

import models
from deps import get_db
from services import (
    COL_MAP,
    build_order_product_id,
    clear_runtime_caches,
    has_non_profit_data,
    normalize_float_cell,
    normalize_string_cell,
    refresh_materialized_summaries,
)


router = APIRouter()


@router.post("/upload")
async def upload_file(date: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    content = await file.read()
    try:
        df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read excel: {str(e)}")

    if "产品编号" not in df.columns or "商品名称" not in df.columns:
        raise HTTPException(status_code=400, detail="Excel must contain '产品编号' and '商品名称'")

    df = df.fillna(0)
    for col in df.columns:
        if df[col].dtype == "object" and col not in ["产品编号", "商品名称"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    present_metric_pairs = [
        (excel_col, model_col)
        for excel_col, model_col in COL_MAP.items()
        if excel_col in df.columns
    ]
    metric_model_fields = [model_col for _, model_col in present_metric_pairs]
    selected_columns = ["产品编号", "商品名称", *[excel_col for excel_col, _ in present_metric_pairs]]

    parsed_rows = []
    seen_product_ids = []
    for row in df[selected_columns].itertuples(index=False, name=None):
        product_id = normalize_string_cell(row[0])
        product_name = normalize_string_cell(row[1])
        if not product_id:
            continue

        data_mapping = {
            "product_id": product_id,
            "date": target_date,
        }
        for value_index, model_col in enumerate(metric_model_fields, start=2):
            data_mapping[model_col] = normalize_float_cell(row[value_index])

        parsed_rows.append((product_id, product_name, data_mapping))
        seen_product_ids.append(product_id)

    unique_product_ids = list(dict.fromkeys(seen_product_ids))

    try:
        existing_records = db.query(
            models.DailyData.product_id,
            models.DailyData.profit,
        ).filter(
            models.DailyData.date == target_date
        ).all()
        existing_profits = {
            product_id: float(profit or 0)
            for record in existing_records
            for product_id, profit in [record]
            if profit and profit != 0
        }

        existing_products = {}
        if unique_product_ids:
            existing_products = {
                product.id: product
                for product in db.query(models.Product).filter(models.Product.id.in_(unique_product_ids)).all()
            }
        known_product_ids = set(existing_products)

        db.query(models.DailyData).filter(
            models.DailyData.date == target_date
        ).delete(synchronize_session=False)

        new_product_mappings = []
        daily_data_mappings = []
        for product_id, product_name, data_mapping in parsed_rows:
            product = existing_products.get(product_id)
            if product is not None:
                if product.name != product_name:
                    product.name = product_name
            elif product_id not in known_product_ids:
                known_product_ids.add(product_id)
                new_product_mappings.append({"id": product_id, "name": product_name})

            data_mapping["profit"] = existing_profits.get(product_id, 0.0)
            daily_data_mappings.append(data_mapping)

        new_product_id_set = set(unique_product_ids)
        for product_id, old_profit in existing_profits.items():
            if product_id not in new_product_id_set:
                daily_data_mappings.append(
                    {"product_id": product_id, "date": target_date, "profit": old_profit}
                )

        if new_product_mappings:
            db.bulk_insert_mappings(models.Product, new_product_mappings)
        if daily_data_mappings:
            db.bulk_insert_mappings(models.DailyData, daily_data_mappings)

        refresh_materialized_summaries(db, target_date)
        db.commit()
        clear_runtime_caches()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to store excel data: {exc}") from exc

    return {"message": "商品数据上传成功（利润数据已保留）"}


@router.post("/upload_orders")
def upload_orders(
    file: UploadFile = File(...),
    date: str = Form(...),
    db: Session = Depends(get_db),
):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    contents = file.file.read()
    try:
        df = pd.read_excel(io.BytesIO(contents), header=2)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading Excel file: {str(e)}")

    required_cols = ["旅游线路", "利润"]
    for col in required_cols:
        if col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Order Excel must contain '{col}' column.")

    normal_count = 0
    pending_count = 0
    pending_order_mappings = []
    profit_by_route_name = defaultdict(float)

    column_index = {column_name: idx for idx, column_name in enumerate(df.columns)}
    route_idx = column_index["旅游线路"]
    profit_idx = column_index["利润"]
    order_number_idx = column_index.get("订单序号")
    order_id_idx = column_index.get("订单号")
    specification_idx = column_index.get("规格")
    quantity_idx = column_index.get("数量")
    unit_price_idx = column_index.get("单价")
    total_amount_idx = column_index.get("总额")
    commission_idx = column_index.get("佣金")
    salesperson_idx = column_index.get("销售")

    for row in df.itertuples(index=False, name=None):
        route_name = row[route_idx]
        if pd.isna(route_name):
            continue

        route_name = normalize_string_cell(route_name)
        profit_val = normalize_float_cell(row[profit_idx])

        if profit_val <= 0:
            pending_order_mappings.append({
                "date": target_date,
                "order_number": normalize_string_cell(row[order_number_idx]) if order_number_idx is not None else "",
                "order_id": normalize_string_cell(row[order_id_idx]) if order_id_idx is not None else "",
                "product_name": route_name,
                "specification": normalize_string_cell(row[specification_idx]) if specification_idx is not None else "",
                "quantity": normalize_float_cell(row[quantity_idx]) if quantity_idx is not None else 0.0,
                "unit_price": normalize_float_cell(row[unit_price_idx]) if unit_price_idx is not None else 0.0,
                "total_amount": normalize_float_cell(row[total_amount_idx]) if total_amount_idx is not None else 0.0,
                "commission": normalize_float_cell(row[commission_idx]) if commission_idx is not None else 0.0,
                "profit": profit_val,
                "salesperson": normalize_string_cell(row[salesperson_idx]) if salesperson_idx is not None else "",
                "status": "pending",
            })
            pending_count += 1
            continue

        profit_by_route_name[route_name] += profit_val
        normal_count += 1

    try:
        records_on_date = db.query(models.DailyData).filter(
            models.DailyData.date == target_date
        ).all()
        for r in records_on_date:
            if has_non_profit_data(r):
                r.profit = 0
            else:
                db.delete(r)

        db.query(models.PendingOrder).filter(
            models.PendingOrder.date == target_date,
            models.PendingOrder.status == "pending"
        ).delete(synchronize_session=False)

        db.flush()

        if pending_order_mappings:
            db.bulk_insert_mappings(models.PendingOrder, pending_order_mappings)

        route_names = list(profit_by_route_name.keys())
        products_by_name = {}
        if route_names:
            existing_products = db.query(models.Product.id, models.Product.name).filter(
                models.Product.name.in_(route_names)
            ).all()
            for product_id, product_name in existing_products:
                products_by_name.setdefault(product_name, product_id)

            new_product_mappings = []
            for route_name in route_names:
                if route_name not in products_by_name:
                    product_id = build_order_product_id(route_name)
                    products_by_name[route_name] = product_id
                    new_product_mappings.append({"id": product_id, "name": route_name})

            if new_product_mappings:
                db.bulk_insert_mappings(models.Product, new_product_mappings)

            target_product_ids = list(products_by_name.values())
            existing_daily_data = {
                row.product_id: row
                for row in db.query(models.DailyData).filter(
                    models.DailyData.date == target_date,
                    models.DailyData.product_id.in_(target_product_ids),
                ).all()
            }

            new_daily_row_mappings = []
            for route_name, total_profit in profit_by_route_name.items():
                product_id = products_by_name[route_name]
                daily_data = existing_daily_data.get(product_id)
                if daily_data:
                    daily_data.profit = total_profit
                else:
                    new_daily_row_mappings.append({
                        "product_id": product_id,
                        "date": target_date,
                        "profit": total_profit,
                    })

            if new_daily_row_mappings:
                db.bulk_insert_mappings(models.DailyData, new_daily_row_mappings)

        refresh_materialized_summaries(db, target_date)
        db.commit()
        clear_runtime_caches()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to store order data: {exc}") from exc

    msg = f"订单数据上传成功：{normal_count}条正常录入"
    if pending_count > 0:
        msg += f"，{pending_count}条利润异常订单已进入审核队列"
    return {"message": msg, "normal_count": normal_count, "pending_count": pending_count}


@router.delete("/data")
def delete_data(date: str, db: Session = Depends(get_db)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    deleted = db.query(models.DailyData).filter(models.DailyData.date == target_date).delete()
    deleted_reviews = db.query(models.PendingOrder).filter(models.PendingOrder.date == target_date).delete()
    refresh_materialized_summaries(db, target_date)
    db.commit()
    clear_runtime_caches()

    if deleted > 0 or deleted_reviews > 0:
        msg = f"成功清除了 {date} 的全部数据"
        if deleted_reviews > 0:
            msg += f"，并移除了 {deleted_reviews} 条审核订单记录"
        return {"message": msg}
    else:
        return {"message": f"{date} 当天没有可删除的数据"}


@router.delete("/data/commodity")
def delete_commodity_data(date: str, db: Session = Depends(get_db)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    records = db.query(models.DailyData).filter(models.DailyData.date == target_date).all()
    count = 0
    for r in records:
        if not r.profit or r.profit == 0:
            db.delete(r)
        else:
            for col in r.__table__.columns:
                if col.name not in ["id", "product_id", "date", "profit"]:
                    setattr(r, col.name, 0)
        count += 1
    refresh_materialized_summaries(db, target_date)
    db.commit()
    clear_runtime_caches()

    if count > 0:
        return {"message": f"成功清空了 {date} 的商品常规数据"}
    else:
        return {"message": f"{date} 当天没有相应的商品常规数据"}


@router.delete("/data/order")
def delete_order_data(date: str, db: Session = Depends(get_db)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    records = db.query(models.DailyData).filter(models.DailyData.date == target_date).all()
    count = 0
    for r in records:
        is_empty = True
        for col in r.__table__.columns:
            if col.name not in ["id", "product_id", "date", "profit"]:
                val = getattr(r, col.name)
                if val and val != 0:
                    is_empty = False
                    break
        if is_empty:
            db.delete(r)
        else:
            r.profit = 0
        count += 1

    deleted_reviews = db.query(models.PendingOrder).filter(
        models.PendingOrder.date == target_date
    ).delete()
    refresh_materialized_summaries(db, target_date)
    db.commit()
    clear_runtime_caches()

    if count > 0 or deleted_reviews > 0:
        msg = f"成功清空了 {date} 的订单利润数据"
        if deleted_reviews > 0:
            msg += f"，并移除了 {deleted_reviews} 条审核订单记录"
        return {"message": msg}
    else:
        return {"message": f"{date} 当天没有相应的订单利润数据"}

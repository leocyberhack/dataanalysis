import hashlib
import io
import os
import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
from fastapi import Body, FastAPI, UploadFile, File, Depends, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel
import models
from database import engine, SessionLocal
from sqlalchemy import text

models.Base.metadata.create_all(bind=engine)

# --- Auto-migration: add columns / tables that may not exist in older DBs ---
def _run_migrations():
    with engine.connect() as conn:
        # 1. Add 'profit' column to daily_data if missing
        try:
            conn.execute(text("SELECT profit FROM daily_data LIMIT 1"))
        except Exception:
            conn.rollback()
            conn.execute(text("ALTER TABLE daily_data ADD COLUMN profit FLOAT DEFAULT 0"))
            conn.commit()

        # 2. pending_orders table is handled by create_all above,
        #    but double-check it exists
        try:
            conn.execute(text("SELECT 1 FROM pending_orders LIMIT 1"))
        except Exception:
            conn.rollback()
            models.Base.metadata.tables['pending_orders'].create(bind=engine)
            conn.commit()

        # 3. Add 'salesperson' column to pending_orders if missing
        try:
            conn.execute(text("SELECT salesperson FROM pending_orders LIMIT 1"))
        except Exception:
            conn.rollback()
            conn.execute(text("ALTER TABLE pending_orders ADD COLUMN salesperson TEXT DEFAULT ''"))
            conn.commit()

        # 4. daily_product_summaries table is handled by create_all above,
        #    but double-check it exists for older databases
        try:
            conn.execute(text("SELECT 1 FROM daily_product_summaries LIMIT 1"))
        except Exception:
            conn.rollback()
            models.Base.metadata.tables["daily_product_summaries"].create(bind=engine)
            conn.commit()

        # 5. Add indexes used by hot query paths
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_name ON products (name)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_data_product_id_date ON daily_data (product_id, date)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pending_orders_status_date_id ON pending_orders (status, date, id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_product_summaries_date_product_id ON daily_product_summaries (date, product_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_product_summaries_product_id_date ON daily_product_summaries (product_id, date)"))
        conn.commit()

_run_migrations()


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

COL_MAP = {
    "访客数": "visitor_count",
    "商品详情页跳出率": "bounce_rate",
    "支付金额": "pay_amount",
    "支付转化率": "pay_conversion",
    "成功退款率(金额)": "refund_rate_amount",
    "核销率(金额)": "redeem_rate_amount",
    "店播支付金额": "live_pay_amount",
    "价格倍数": "price_multiplier",
    "浏览量": "page_views",
    "访客平均价值": "avg_visitor_value",
    "下单用户数": "order_users",
    "下单金额": "order_amount",
    "下单转化率": "order_conversion",
    "支付用户数": "pay_users",
    "支付订单数": "pay_orders",
    "支付件数": "pay_items",
    "下单用户支付率": "order_user_pay_rate",
    "静默支付转化率": "silent_pay_conversion",
    "成功退款件数": "refund_items",
    "成功退款金额": "refund_amount",
    "成功退款率(件)": "refund_rate_item",
    "核销件数": "redeem_items",
    "核销金额": "redeem_amount",
    "核销率(件)": "redeem_rate_item",
    "店播支付订单量": "live_pay_orders",
    "店播支付用户数": "live_pay_users",
    "店播支付券量": "live_pay_coupons",
    "店播消费金额": "live_consume_amount",
    "店播消费券量": "live_consume_coupons",
    "店播消费订单量": "live_consume_orders",
    "店播退款金额": "live_refund_amount",
    "店播消费率": "live_consume_rate",
    "店播退款率": "live_refund_rate",
}

COMPARE_METRIC_FIELDS = [
    column.name
    for column in models.DailyData.__table__.columns
    if column.name not in {"id", "product_id", "date"}
]

DAILY_PRODUCT_SUMMARY_FIELDS = [
    column.name
    for column in models.DailyProductSummary.__table__.columns
    if column.name not in {"date", "product_id", "product_name"}
]


def parse_product_ids(product_ids):
    if not product_ids:
        return []
    return [item.strip() for item in product_ids.split(",") if item.strip()]


def parse_compare_metrics(metrics):
    if not metrics:
        return list(COMPARE_METRIC_FIELDS)

    parsed_metrics = []
    seen_metrics = set()
    invalid_metrics = []

    for item in metrics.split(","):
        metric = item.strip()
        if not metric or metric in seen_metrics:
            continue
        if metric not in COMPARE_METRIC_FIELDS:
            invalid_metrics.append(metric)
            continue
        parsed_metrics.append(metric)
        seen_metrics.add(metric)

    if invalid_metrics:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid compare metrics: {', '.join(invalid_metrics)}",
        )
    if not parsed_metrics:
        raise HTTPException(status_code=400, detail="At least one compare metric is required")

    return parsed_metrics


def apply_product_filter(query, product_ids, model=models.DailyData):
    if product_ids:
        query = query.filter(model.product_id.in_(product_ids))
    return query


NON_ADDITIVE_AVERAGE_FIELDS = {
    "bounce_rate",
    "price_multiplier",
    "silent_pay_conversion",
    "live_consume_rate",
}

TREND_AVERAGE_FIELDS = NON_ADDITIVE_AVERAGE_FIELDS.union({
    "avg_visitor_value",
    "order_conversion",
    "pay_conversion",
    "order_user_pay_rate",
    "refund_rate_amount",
    "refund_rate_item",
    "redeem_rate_amount",
    "redeem_rate_item",
    "live_refund_rate",
})

COMPARE_TOTAL_DEPENDENCIES = {
    "avg_visitor_value": {"pay_amount", "visitor_count"},
    "order_conversion": {"order_users", "visitor_count"},
    "pay_conversion": {"pay_users", "visitor_count"},
    "order_user_pay_rate": {"pay_users", "order_users"},
    "refund_rate_amount": {"refund_amount", "pay_amount"},
    "refund_rate_item": {"refund_items", "pay_items"},
    "redeem_rate_amount": {"redeem_amount", "pay_amount"},
    "redeem_rate_item": {"redeem_items", "pay_items"},
    "live_refund_rate": {"live_refund_amount", "live_consume_amount"},
}

TOTAL_RATE_FIELDS = (
    "pay_amount",
    "pay_orders",
    "pay_items",
    "redeem_items",
    "redeem_amount",
    "refund_amount",
    "refund_items",
    "live_refund_amount",
    "live_consume_amount",
    "profit",
)

class ProductDateIndex:
    _CACHE_TTL = 60  # seconds

    def __init__(self):
        self._index = None
        self._all_products = None
        self._loaded_at = 0
    
    def clear(self):
        self._index = None
        self._all_products = None
        self._loaded_at = 0
    
    def _is_stale(self):
        return self._index is None or (time.monotonic() - self._loaded_at) > self._CACHE_TTL
    
    def get_products(self, db, start_date=None, end_date=None):
        if self._is_stale():
            results = db.query(
                models.DailyProductSummary.product_id,
                models.Product.name,
                models.DailyProductSummary.date
            ).join(
                models.Product,
                models.DailyProductSummary.product_id == models.Product.id
            ).all()
            
            products_map = {}
            for pid, pname, pdt in results:
                try:
                    pdt_val = pdt.strftime("%Y-%m-%d")
                except AttributeError:
                    pdt_val = str(pdt)
                if pid not in products_map:
                    products_map[pid] = {'name': pname, 'dates': set()}
                products_map[pid]['dates'].add(pdt_val)
                
            self._index = sorted([
                (pid, data['name'], data['dates'])
                for pid, data in products_map.items()
            ], key=lambda x: x[1])
            
            self._all_products = sorted([
                 {"id": p.id, "name": p.name} 
                 for p in db.query(models.Product).all()
            ], key=lambda x: x["name"])

            self._loaded_at = time.monotonic()
        
        if not start_date or not end_date:
            return self._all_products
            
        start_str = start_date.strftime("%Y-%m-%d") if hasattr(start_date, "strftime") else str(start_date)
        end_str = end_date.strftime("%Y-%m-%d") if hasattr(end_date, "strftime") else str(end_date)
            
        res = []
        for pid, pname, dates in self._index:
            if any(start_str <= d <= end_str for d in dates):
                res.append({"id": pid, "name": pname})
        return res

PRODUCT_INDEX = ProductDateIndex()


def safe_divide(numerator, denominator, multiplier=1):
    if not denominator:
        return 0.0
    return float(numerator or 0) / float(denominator) * multiplier


def compute_display_metric_value(metric, sum_values, avg_values):
    if metric == "avg_visitor_value":
        return safe_divide(sum_values.get("pay_amount"), sum_values.get("visitor_count"))
    if metric == "order_conversion":
        return safe_divide(sum_values.get("order_users"), sum_values.get("visitor_count"), 100)
    if metric == "pay_conversion":
        return safe_divide(sum_values.get("pay_users"), sum_values.get("visitor_count"), 100)
    if metric == "order_user_pay_rate":
        return safe_divide(sum_values.get("pay_users"), sum_values.get("order_users"), 100)
    if metric == "refund_rate_amount":
        return safe_divide(sum_values.get("refund_amount"), sum_values.get("pay_amount"), 100)
    if metric == "refund_rate_item":
        return safe_divide(sum_values.get("refund_items"), sum_values.get("pay_items"), 100)
    if metric == "redeem_rate_amount":
        return safe_divide(sum_values.get("redeem_amount"), sum_values.get("pay_amount"), 100)
    if metric == "redeem_rate_item":
        return safe_divide(sum_values.get("redeem_items"), sum_values.get("pay_items"), 100)
    if metric == "live_refund_rate":
        return safe_divide(sum_values.get("live_refund_amount"), sum_values.get("live_consume_amount"), 100)
    if metric in NON_ADDITIVE_AVERAGE_FIELDS:
        return float(avg_values.get(metric) or 0)
    return float(sum_values.get(metric) or 0)


def has_non_profit_data(record):
    for column in record.__table__.columns:
        if column.name in {"id", "product_id", "date", "profit"}:
            continue
        value = getattr(record, column.name)
        if value and value != 0:
            return True
    return False


def normalize_string_cell(value):
    if pd.isna(value):
        return ""
    return str(value).strip()


def normalize_float_cell(value):
    if pd.isna(value):
        return 0.0
    return float(value)


def build_order_product_id(product_name):
    return "order_" + hashlib.md5(product_name.encode("utf-8")).hexdigest()


def clear_runtime_caches():
    PRODUCT_INDEX.clear()


def refresh_daily_product_summary(db, target_date):
    db.flush()
    db.query(models.DailyProductSummary).filter(
        models.DailyProductSummary.date == target_date
    ).delete(synchronize_session=False)

    field_list = ", ".join(DAILY_PRODUCT_SUMMARY_FIELDS)
    coalesce_list = ", ".join(f"COALESCE(d.{f}, 0)" for f in DAILY_PRODUCT_SUMMARY_FIELDS)
    db.execute(
        text(
            f"INSERT INTO daily_product_summaries (date, product_id, product_name, {field_list}) "
            f"SELECT d.date, d.product_id, p.name, {coalesce_list} "
            f"FROM daily_data d JOIN products p ON d.product_id = p.id "
            f"WHERE d.date = :target_date"
        ),
        {"target_date": target_date},
    )


def refresh_daily_summary(db, target_date):
    db.flush()
    aggregate_columns = [
        func.sum(getattr(models.DailyData, field)).label(field)
        for field in TOTAL_RATE_FIELDS
    ]
    result = db.query(*aggregate_columns).filter(
        models.DailyData.date == target_date
    ).first()

    if not result or all(getattr(result, field) is None for field in TOTAL_RATE_FIELDS):
        db.query(models.DailySummary).filter(
            models.DailySummary.date == target_date
        ).delete(synchronize_session=False)
        return

    values = {
        field: float(getattr(result, field) or 0)
        for field in TOTAL_RATE_FIELDS
    }
    values["commodity_uploaded"] = values["pay_amount"] > 0
    values["order_uploaded"] = abs(values["profit"]) > 0.01

    summary = db.query(models.DailySummary).filter(
        models.DailySummary.date == target_date
    ).first()
    if summary:
        for key, value in values.items():
            setattr(summary, key, value)
    else:
        db.add(models.DailySummary(date=target_date, **values))


def refresh_materialized_summaries(db, target_date):
    refresh_daily_product_summary(db, target_date)
    refresh_daily_summary(db, target_date)


def ensure_daily_summaries():
    db = SessionLocal()
    try:
        data_date_count = db.query(
            func.count(func.distinct(models.DailyData.date))
        ).scalar() or 0
        summary_count = db.query(func.count(models.DailySummary.date)).scalar() or 0

        if data_date_count == summary_count:
            return

        db.query(models.DailySummary).delete(synchronize_session=False)
        dates = [
            row[0]
            for row in db.query(models.DailyData.date).distinct().all()
            if row[0] is not None
        ]
        for target_date in dates:
            refresh_daily_summary(db, target_date)
        db.commit()
    finally:
        db.close()


def ensure_daily_product_summaries():
    db = SessionLocal()
    try:
        data_row_count = db.query(func.count(models.DailyData.id)).scalar() or 0
        summary_row_count = db.query(func.count()).select_from(models.DailyProductSummary).scalar() or 0

        if data_row_count == summary_row_count:
            return

        db.query(models.DailyProductSummary).delete(synchronize_session=False)
        dates = [
            row[0]
            for row in db.query(models.DailyData.date).distinct().all()
            if row[0] is not None
        ]
        for target_date in dates:
            refresh_daily_product_summary(db, target_date)
        db.commit()
    finally:
        db.close()


ensure_daily_summaries()
ensure_daily_product_summaries()


@app.post("/upload")
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

    # Replace invalid values and NaNs with 0
    df = df.fillna(0)
    for col in df.columns:
        if df[col].dtype == 'object' and col not in ['产品编号', '商品名称']:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

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

@app.post("/upload_orders")
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
        
    required_cols = ['旅游线路', '利润']
    for col in required_cols:
        if col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Order Excel must contain '{col}' column.")

    normal_count = 0
    pending_count = 0
    pending_order_mappings = []
    profit_by_route_name = defaultdict(float)

    column_index = {column_name: idx for idx, column_name in enumerate(df.columns)}
    route_idx = column_index['旅游线路']
    profit_idx = column_index['利润']
    order_number_idx = column_index.get('订单序号')
    order_id_idx = column_index.get('订单号')
    specification_idx = column_index.get('规格')
    quantity_idx = column_index.get('数量')
    unit_price_idx = column_index.get('单价')
    total_amount_idx = column_index.get('总额')
    commission_idx = column_index.get('佣金')
    salesperson_idx = column_index.get('销售')

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

@app.get("/dates")
def get_dates(db: Session = Depends(get_db)):
    dates = db.query(models.DailySummary.date).order_by(models.DailySummary.date.desc()).all()
    return {"dates": [d[0].strftime("%Y-%m-%d") for d in dates]}

@app.get("/date_status")
def get_date_status(db: Session = Depends(get_db)):
    results = db.query(models.DailySummary).order_by(models.DailySummary.date.desc()).all()
    return {
        row.date.strftime("%Y-%m-%d"): {
            "commodity": bool(row.commodity_uploaded),
            "order": bool(row.order_uploaded),
        }
        for row in results
    }

@app.get("/products")
def get_products(startDate: str = None, endDate: str = None, db: Session = Depends(get_db)):
    if startDate and endDate:
        try:
            start = datetime.strptime(startDate, "%Y-%m-%d").date()
            end = datetime.strptime(endDate, "%Y-%m-%d").date()
            return PRODUCT_INDEX.get_products(db, start, end)
        except ValueError:
            pass # fallback to all products if date invalid
    return PRODUCT_INDEX.get_products(db)

def compute_total_rate(db, start_date, end_date, product_ids=None):
    if product_ids:
        result = db.query(
            func.sum(models.DailyProductSummary.pay_amount).label('pay_amount'),
            func.sum(models.DailyProductSummary.pay_orders).label('pay_orders'),
            func.sum(models.DailyProductSummary.pay_items).label('pay_items'),
            func.sum(models.DailyProductSummary.redeem_items).label('redeem_items'),
            func.sum(models.DailyProductSummary.redeem_amount).label('redeem_amount'),
            func.sum(models.DailyProductSummary.refund_amount).label('refund_amount'),
            func.sum(models.DailyProductSummary.refund_items).label('refund_items'),
            func.sum(models.DailyProductSummary.live_refund_amount).label('live_refund_amount'),
            func.sum(models.DailyProductSummary.live_consume_amount).label('live_consume_amount'),
            func.sum(models.DailyProductSummary.profit).label('profit'),
        ).filter(
            models.DailyProductSummary.date >= start_date,
            models.DailyProductSummary.date <= end_date,
        )
        result = apply_product_filter(result, product_ids, models.DailyProductSummary).first()
    else:
        result = db.query(
            func.sum(models.DailySummary.pay_amount).label('pay_amount'),
            func.sum(models.DailySummary.pay_orders).label('pay_orders'),
            func.sum(models.DailySummary.pay_items).label('pay_items'),
            func.sum(models.DailySummary.redeem_items).label('redeem_items'),
            func.sum(models.DailySummary.redeem_amount).label('redeem_amount'),
            func.sum(models.DailySummary.refund_amount).label('refund_amount'),
            func.sum(models.DailySummary.refund_items).label('refund_items'),
            func.sum(models.DailySummary.live_refund_amount).label('live_refund_amount'),
            func.sum(models.DailySummary.live_consume_amount).label('live_consume_amount'),
            func.sum(models.DailySummary.profit).label('profit'),
        ).filter(models.DailySummary.date >= start_date, models.DailySummary.date <= end_date).first()

    if not result:
        return None

    raw_values = [
        result.pay_amount,
        result.pay_orders,
        result.pay_items,
        result.redeem_items,
        result.redeem_amount,
        result.refund_amount,
        result.refund_items,
        result.live_refund_amount,
        result.live_consume_amount,
        result.profit,
    ]
    if all(value is None for value in raw_values):
         return None
         
    pay_amount = float(result.pay_amount or 0)
    pay_orders = float(result.pay_orders or 0)
    pay_items = float(result.pay_items or 0)
    redeem_items = float(result.redeem_items or 0)
    redeem_amount = float(result.redeem_amount or 0)
    refund_amount = float(result.refund_amount or 0)
    refund_items = float(result.refund_items or 0)
    live_refund_amount = float(result.live_refund_amount or 0)
    live_consume_amount = float(result.live_consume_amount or 0)
    profit = float(result.profit or 0)
    
    redeem_rate_amount = (redeem_amount / pay_amount * 100) if pay_amount > 0 else 0
    redeem_rate_item = (redeem_items / pay_items * 100) if pay_items > 0 else 0
    live_refund_rate = (live_refund_amount / live_consume_amount * 100) if live_consume_amount > 0 else 0
    refund_rate_amount = (refund_amount / pay_amount * 100) if pay_amount > 0 else 0
    refund_rate_item = (refund_items / pay_items * 100) if pay_items > 0 else 0
    profit_margin = (profit / redeem_amount * 100) if redeem_amount > 0 else 0
    
    return {
        "pay_amount": pay_amount,
        "redeem_rate_amount": redeem_rate_amount,
        "pay_orders": pay_orders,
        "redeem_items": redeem_items,
        "redeem_amount": redeem_amount,
        "refund_amount": refund_amount,
        "refund_rate_amount": refund_rate_amount,
        "refund_items": refund_items,
        "refund_rate_item": refund_rate_item,
        "live_refund_amount": live_refund_amount,
        "live_refund_rate": live_refund_rate,
        "redeem_rate_item": redeem_rate_item,
        "profit": profit,
        "profit_margin": profit_margin
    }

@app.get("/summary")
def get_summary(
    date: str = None,
    startDate: str = None,
    endDate: str = None,
    productIds: str = None,
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
    calc_today = compute_total_rate(db, start_dt, end_dt, parsed_product_ids)
    if not calc_today:
        return {"today": None, "yesterday": None, "has_yesterday": False}
        
    delta_days = (end_dt - start_dt).days + 1
    prev_end_dt = start_dt - timedelta(days=1)
    prev_start_dt = start_dt - timedelta(days=delta_days)
    
    calc_yesterday = compute_total_rate(db, prev_start_dt, prev_end_dt, parsed_product_ids)
    
    changes = {}
    if calc_yesterday:
        for k in calc_today:
            old_val = calc_yesterday[k]
            new_val = calc_today[k]
            if old_val == 0:
                changes[k] = 100.0 if new_val > 0 else 0.0
            else:
                changes[k] = ((new_val - old_val) / old_val) * 100
                
    return {
        "today": calc_today,
        "yesterday": calc_yesterday,
        "changes": changes,
        "has_yesterday": bool(calc_yesterday)
    }

@app.get("/data")
def get_data(startDate: str, endDate: str, productIds: str = None, db: Session = Depends(get_db)):
    try:
        start = datetime.strptime(startDate, "%Y-%m-%d").date()
        end = datetime.strptime(endDate, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid dates")
        
    query = db.query(models.DailyData, models.Product.name.label("product_name"))\
             .join(models.Product, models.DailyData.product_id == models.Product.id)\
             .filter(models.DailyData.date >= start, models.DailyData.date <= end)

    query = apply_product_filter(query, parse_product_ids(productIds))
        
    results = query.all()
    
    out = []
    for r, pname in results:
        row_dict = {c.name: getattr(r, c.name) for c in r.__table__.columns}
        row_dict["product_name"] = pname
        row_dict["date"] = row_dict["date"].strftime("%Y-%m-%d")
        out.append(row_dict)
        
    return out


@app.get("/compare/aggregate")
def get_compare_aggregate(
    startDate: str,
    endDate: str,
    productIds: str = None,
    metrics: str = None,
    db: Session = Depends(get_db),
):
    try:
        start = datetime.strptime(startDate, "%Y-%m-%d").date()
        end = datetime.strptime(endDate, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid dates")

    parsed_product_ids = parse_product_ids(productIds)
    selected_metrics = parse_compare_metrics(metrics)
    sum_metrics = list(dict.fromkeys(
        metric
        for selected_metric in selected_metrics
        for metric in [selected_metric, *COMPARE_TOTAL_DEPENDENCIES.get(selected_metric, ())]
    ))
    dependency_only_metrics = [metric for metric in sum_metrics if metric not in selected_metrics]
    selected_range_day_count = (end - start).days + 1

    query_columns = [
        models.DailyProductSummary.product_id,
        models.Product.name.label("product_name"),
        func.count(func.distinct(models.DailyProductSummary.date)).label("days_count"),
    ]
    for metric in selected_metrics:
        metric_column = getattr(models.DailyProductSummary, metric)
        weight_col = None

        if metric in {"bounce_rate", "silent_pay_conversion"}:
            weight_col = models.DailyProductSummary.visitor_count
        elif metric == "live_consume_rate":
            weight_col = models.DailyProductSummary.live_pay_users
        elif metric == "price_multiplier":
            weight_col = models.DailyProductSummary.pay_users

        if weight_col is not None:
            avg_expr = func.sum(metric_column * weight_col) / func.nullif(func.sum(weight_col), 0)
        else:
            avg_expr = func.avg(metric_column)

        query_columns.extend([
            func.sum(metric_column).label(f"{metric}_total"),
            func.max(metric_column).label(f"{metric}_max"),
            func.min(metric_column).label(f"{metric}_min"),
            avg_expr.label(f"{metric}_avg_existing"),
        ])
        if weight_col is not None:
            query_columns.append(func.sum(weight_col).label(f"{metric}_weight_sum"))
    for metric in dependency_only_metrics:
        metric_column = getattr(models.DailyProductSummary, metric)
        query_columns.append(func.sum(metric_column).label(f"{metric}_total"))

    query = db.query(*query_columns).join(
        models.Product,
        models.DailyProductSummary.product_id == models.Product.id,
    ).filter(
        models.DailyProductSummary.date >= start,
        models.DailyProductSummary.date <= end,
    )
    query = apply_product_filter(query, parsed_product_ids, models.DailyProductSummary)

    results = query.group_by(
        models.DailyProductSummary.product_id,
        models.Product.name,
    ).all()
    rows = []
    # Compute overall totals from per-product results (eliminates a duplicate DB query)
    overall_sum_values = {metric: 0.0 for metric in sum_metrics}
    overall_weighted_numerators = {}
    overall_weight_denominators = {}

    for result in results:
        for metric in sum_metrics:
            overall_sum_values[metric] += float(getattr(result, f"{metric}_total") or 0)
        for metric in selected_metrics:
            if metric in NON_ADDITIVE_AVERAGE_FIELDS:
                weight_sum = float(getattr(result, f"{metric}_weight_sum", 0) or 0)
                avg_val = float(getattr(result, f"{metric}_avg_existing") or 0)
                overall_weighted_numerators[metric] = overall_weighted_numerators.get(metric, 0) + avg_val * weight_sum
                overall_weight_denominators[metric] = overall_weight_denominators.get(metric, 0) + weight_sum

    overall_avg_values = {}
    for metric in selected_metrics:
        if metric in NON_ADDITIVE_AVERAGE_FIELDS:
            denom = overall_weight_denominators.get(metric, 0)
            overall_avg_values[metric] = (overall_weighted_numerators.get(metric, 0) / denom) if denom else 0.0
        else:
            overall_avg_values[metric] = 0.0

    overall_totals = {
        metric: compute_display_metric_value(metric, overall_sum_values, overall_avg_values)
        for metric in selected_metrics
    }

    for result in results:
        row = {
            "product_id": result.product_id,
            "product_name": result.product_name,
            "days_count": int(result.days_count or 0),
        }
        row_sum_values = {
            metric: float(getattr(result, f"{metric}_total") or 0)
            for metric in sum_metrics
        }
        row_avg_values = {
            metric: float(getattr(result, f"{metric}_avg_existing") or 0)
            for metric in selected_metrics
        }
        for metric in selected_metrics:
            row[f"{metric}_avg"] = (
                row_sum_values[metric] / selected_range_day_count if selected_range_day_count > 0 else 0
            )
            row[f"{metric}_total"] = compute_display_metric_value(metric, row_sum_values, row_avg_values)
            row[f"{metric}_max"] = float(getattr(result, f"{metric}_max") or 0)
            row[f"{metric}_min"] = float(getattr(result, f"{metric}_min") or 0)
        rows.append(row)

    return {
        "rows": rows,
        "overall_totals": overall_totals,
        "selected_range_day_count": selected_range_day_count,
    }


@app.get("/compare/trend")
def get_compare_trend(
    startDate: str,
    endDate: str,
    metric: str,
    productIds: str = None,
    axisProductIds: str = None,
    includeDates: bool = False,
    db: Session = Depends(get_db),
):
    try:
        start = datetime.strptime(startDate, "%Y-%m-%d").date()
        end = datetime.strptime(endDate, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid dates")

    selected_metric = parse_compare_metrics(metric)[0]
    trend_product_ids = parse_product_ids(productIds)
    axis_product_ids = parse_product_ids(axisProductIds) or trend_product_ids
    metric_column = getattr(models.DailyProductSummary, selected_metric)

    query = db.query(
        models.DailyProductSummary.product_id,
        models.Product.name.label("product_name"),
        models.DailyProductSummary.date,
        metric_column.label("metric_value"),
    ).join(
        models.Product,
        models.DailyProductSummary.product_id == models.Product.id,
    ).filter(
        models.DailyProductSummary.date >= start,
        models.DailyProductSummary.date <= end,
    )
    query = apply_product_filter(query, trend_product_ids, models.DailyProductSummary)

    results = query.order_by(
        models.DailyProductSummary.date.asc(),
        models.Product.name.asc(),
    ).all()

    date_query = db.query(
        models.DailyProductSummary.date,
    ).filter(
        models.DailyProductSummary.date >= start,
        models.DailyProductSummary.date <= end,
    )
    date_query = apply_product_filter(date_query, axis_product_ids, models.DailyProductSummary)
    distinct_dates = [
        row.date.strftime("%Y-%m-%d")
        for row in date_query.distinct().order_by(models.DailyProductSummary.date.asc()).all()
    ]

    rows = [
        {
            "product_id": row.product_id,
            "product_name": row.product_name,
            "date": row.date.strftime("%Y-%m-%d"),
            "value": float(row.metric_value or 0),
        }
        for row in results
    ]

    if includeDates:
        return {
            "dates": distinct_dates,
            "rows": rows,
        }

    return rows

@app.delete("/data")
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

@app.delete("/data/commodity")
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

@app.delete("/data/order")
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

# ==================== Pending Order Review Endpoints ====================

class UpdateProfitRequest(BaseModel):
    profit: float


class ApproveOrderRequest(BaseModel):
    profit: Optional[float] = None


@app.get("/pending_orders")
def get_pending_orders(db: Session = Depends(get_db)):
    orders = db.query(models.PendingOrder).filter(
        models.PendingOrder.status == "pending"
    ).order_by(models.PendingOrder.date.desc(), models.PendingOrder.id.desc()).all()

    return [{
        "id": o.id,
        "date": o.date.strftime("%Y-%m-%d"),
        "order_number": o.order_number,
        "order_id": o.order_id,
        "product_name": o.product_name,
        "specification": o.specification,
        "quantity": o.quantity,
        "unit_price": o.unit_price,
        "total_amount": o.total_amount,
        "commission": o.commission,
        "profit": o.profit,
        "salesperson": o.salesperson or "",
        "status": o.status
    } for o in orders]


@app.post("/approve_order/{order_id}")
def approve_order(
    order_id: int,
    req: Optional[ApproveOrderRequest] = Body(default=None),
    db: Session = Depends(get_db),
):
    """Approve a pending order and move its profit into DailyData."""
    order = db.query(models.PendingOrder).filter(models.PendingOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail="Order already processed")

    try:
        if req and req.profit is not None:
            order.profit = req.profit

        product = db.query(models.Product).filter(models.Product.name == order.product_name).first()
        if not product:
            product = models.Product(id=build_order_product_id(order.product_name), name=order.product_name)
            db.add(product)
            db.flush()

        daily_data = db.query(models.DailyData).filter_by(
            product_id=product.id, date=order.date
        ).first()
        if daily_data:
            daily_data.profit = (daily_data.profit or 0) + order.profit
        else:
            db.add(models.DailyData(
                product_id=product.id,
                date=order.date,
                profit=order.profit
            ))

        order.status = "approved"
        refresh_materialized_summaries(db, order.date)
        db.commit()
        clear_runtime_caches()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to approve order: {exc}") from exc

    return {"message": f"订单已审核通过，利润 {order.profit} 已录入分析数据"}

@app.put("/pending_order/{order_id}")
def update_pending_order(order_id: int, req: UpdateProfitRequest, db: Session = Depends(get_db)):
    """Update the profit of a pending order before approving."""
    order = db.query(models.PendingOrder).filter(models.PendingOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail="Order already processed")
    
    order.profit = req.profit
    db.commit()
    return {"message": f"利润已更新为 {req.profit}"}


@app.delete("/pending_order/{order_id}")
def delete_pending_order(order_id: int, db: Session = Depends(get_db)):
    """Permanently discard a pending order."""
    order = db.query(models.PendingOrder).filter(models.PendingOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    db.delete(order)
    db.commit()
    return {"message": "订单已删除"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)

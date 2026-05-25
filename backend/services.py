import hashlib
import calendar
import os
import re
import threading
import time
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import func, text

import models
from database import engine, SessionLocal


DATA_CHANGE_VERSION = 0
_RESPONSE_CACHE = {}
_RESPONSE_CACHE_LOCK = threading.Lock()


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

BASE_COMPARE_METRIC_FIELDS = [
    column.name
    for column in models.DailyData.__table__.columns
    if column.name not in {"id", "product_id", "date"}
]

COMPARE_SHARE_METRICS = {
    "profit_share": "profit",
    "refund_share": "refund_amount",
    "pay_share": "pay_amount",
    "redeem_share": "redeem_amount",
}

COMPARE_METRIC_FIELDS = [
    *BASE_COMPARE_METRIC_FIELDS,
    *COMPARE_SHARE_METRICS.keys(),
]

DAILY_PRODUCT_SUMMARY_FIELDS = [
    column.name
    for column in models.DailyProductSummary.__table__.columns
    if column.name not in {"date", "product_id", "product_name"}
]

DEFAULT_POI_CONFIG_FILENAME = "POI.json"
POI_RULE_PATTERN = re.compile(r"^\s*(?P<name>[^()\uFF08\uFF09]+?)\s*(?:[\uFF08(](?P<keywords>.+?)[\uFF09)])?\s*$")
POI_KEYWORD_SPLIT_PATTERN = re.compile(r"[/\uFF0F]")


def _run_migrations():
    with engine.connect() as conn:
        try:
            conn.execute(text("SELECT profit FROM daily_data LIMIT 1"))
        except Exception:
            conn.rollback()
            conn.execute(text("ALTER TABLE daily_data ADD COLUMN profit FLOAT DEFAULT 0"))
            conn.commit()

        try:
            conn.execute(text("SELECT 1 FROM pending_orders LIMIT 1"))
        except Exception:
            conn.rollback()
            models.Base.metadata.tables["pending_orders"].create(bind=engine)
            conn.commit()

        try:
            conn.execute(text("SELECT salesperson FROM pending_orders LIMIT 1"))
        except Exception:
            conn.rollback()
            conn.execute(text("ALTER TABLE pending_orders ADD COLUMN salesperson TEXT DEFAULT ''"))
            conn.commit()

        try:
            conn.execute(text("SELECT 1 FROM daily_product_summaries LIMIT 1"))
        except Exception:
            conn.rollback()
            models.Base.metadata.tables["daily_product_summaries"].create(bind=engine)
            conn.commit()

        try:
            conn.execute(text("SELECT 1 FROM product_poi_map LIMIT 1"))
        except Exception:
            conn.rollback()
            models.Base.metadata.tables["product_poi_map"].create(bind=engine)
            conn.commit()

        try:
            conn.execute(text("SELECT 1 FROM plans LIMIT 1"))
        except Exception:
            conn.rollback()
            models.Base.metadata.tables["plans"].create(bind=engine)
            conn.commit()

        try:
            conn.execute(text("SELECT month_targets FROM plans LIMIT 1"))
        except Exception:
            conn.rollback()
            conn.execute(text("ALTER TABLE plans ADD COLUMN month_targets TEXT DEFAULT '{}'"))
            conn.commit()

        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_name ON products (name)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_data_product_id_date ON daily_data (product_id, date)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pending_orders_status_date_id ON pending_orders (status, date, id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_product_summaries_date_product_id ON daily_product_summaries (date, product_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_product_summaries_product_id_date ON daily_product_summaries (product_id, date)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_product_poi_map_poi_name_product_id ON product_poi_map (poi_name, product_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_plans_metric ON plans (metric)"))
        conn.commit()


def parse_csv_values(raw_value):
    if not raw_value:
        return []
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def parse_product_ids(product_ids):
    return parse_csv_values(product_ids)


def parse_poi_names(poi_names):
    return parse_csv_values(poi_names)


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


def get_poi_config_path():
    raw_path = os.environ.get("POI_CONFIG_PATH")
    if raw_path:
        candidate = Path(raw_path)
        if candidate.exists():
            return candidate

    module_dir = Path(__file__).resolve().parent
    candidate_paths = []
    for candidate in (
        Path.cwd() / DEFAULT_POI_CONFIG_FILENAME,
        module_dir / DEFAULT_POI_CONFIG_FILENAME,
        module_dir.parent / DEFAULT_POI_CONFIG_FILENAME,
    ):
        if candidate not in candidate_paths:
            candidate_paths.append(candidate)

    for candidate in candidate_paths:
        if candidate.exists():
            return candidate

    return candidate_paths[0]


def load_poi_rules():
    poi_config_path = get_poi_config_path()
    if not poi_config_path.exists():
        return []

    rules = []
    with poi_config_path.open("r", encoding="utf-8-sig") as poi_file:
        for raw_line in poi_file:
            line = raw_line.strip()
            if not line:
                continue

            match = POI_RULE_PATTERN.match(line)
            if not match:
                continue

            poi_name = (match.group("name") or "").strip()
            keyword_group = match.group("keywords")
            keywords = [poi_name] if poi_name else []
            if keyword_group:
                keywords.extend(
                    item.strip()
                    for item in POI_KEYWORD_SPLIT_PATTERN.split(keyword_group)
                    if item.strip()
                )
            keywords = list(dict.fromkeys(keywords))

            if poi_name and keywords:
                rules.append({
                    "name": poi_name,
                    "keywords": keywords,
                })

    return rules


def match_product_to_poi(product_name, poi_rules):
    normalized_name = normalize_string_cell(product_name)
    if not normalized_name:
        return None

    for rule in poi_rules:
        if any(keyword in normalized_name for keyword in rule["keywords"]):
            return rule["name"]

    return None


def build_product_poi_map(products, poi_rules=None):
    active_rules = poi_rules if poi_rules is not None else load_poi_rules()
    product_to_poi = {}
    poi_to_product_ids = defaultdict(list)

    for product in products:
        poi_name = match_product_to_poi(product.get("name"), active_rules)
        if not poi_name:
            continue
        product_id = product.get("id")
        product_to_poi[product_id] = poi_name
        poi_to_product_ids[poi_name].append(product_id)

    return {
        "rules": active_rules,
        "product_to_poi": product_to_poi,
        "poi_to_product_ids": dict(poi_to_product_ids),
    }


def get_poi_rules_signature():
    poi_config_path = get_poi_config_path()
    try:
        stat = poi_config_path.stat()
        return str(poi_config_path), stat.st_mtime_ns, stat.st_size
    except OSError:
        return str(poi_config_path), 0, 0


class ProductPoiIndex:
    _CACHE_TTL = 60

    def __init__(self):
        self._rules = None
        self._rules_signature = None
        self._loaded_at = 0

    def clear(self):
        self._rules = None
        self._rules_signature = None
        self._loaded_at = 0

    def get_rules(self):
        signature = get_poi_rules_signature()
        is_stale = (
            self._rules is None
            or self._rules_signature != signature
            or (time.monotonic() - self._loaded_at) > self._CACHE_TTL
        )
        if is_stale:
            self._rules = load_poi_rules()
            self._rules_signature = signature
            self._loaded_at = time.monotonic()
        return self._rules


POI_INDEX = ProductPoiIndex()
_PRODUCT_POI_MAP_SIGNATURE = None
_PRODUCT_POI_MAP_LOCK = threading.Lock()


def refresh_product_poi_mappings(db, products):
    products_by_id = {
        product.get("id"): product.get("name")
        for product in products
        if product.get("id")
    }
    if not products_by_id:
        return

    rules = POI_INDEX.get_rules()
    mappings = []
    for product_id, product_name in products_by_id.items():
        poi_name = match_product_to_poi(product_name, rules)
        if poi_name:
            mappings.append({
                "product_id": product_id,
                "poi_name": poi_name,
            })

    db.query(models.ProductPoiMap).filter(
        models.ProductPoiMap.product_id.in_(list(products_by_id))
    ).delete(synchronize_session=False)
    if mappings:
        db.bulk_insert_mappings(models.ProductPoiMap, mappings)


def refresh_product_poi_map(db, rules_signature=None):
    global _PRODUCT_POI_MAP_SIGNATURE

    rules = POI_INDEX.get_rules()
    products = [
        {"id": product_id, "name": product_name}
        for product_id, product_name in db.query(models.Product.id, models.Product.name).all()
    ]

    db.query(models.ProductPoiMap).delete(synchronize_session=False)
    mappings = []
    for product in products:
        poi_name = match_product_to_poi(product.get("name"), rules)
        if poi_name:
            mappings.append({
                "product_id": product.get("id"),
                "poi_name": poi_name,
            })
    if mappings:
        db.bulk_insert_mappings(models.ProductPoiMap, mappings)

    _PRODUCT_POI_MAP_SIGNATURE = rules_signature or get_poi_rules_signature()


def ensure_product_poi_map(db):
    global _PRODUCT_POI_MAP_SIGNATURE

    rules_signature = get_poi_rules_signature()
    if _PRODUCT_POI_MAP_SIGNATURE == rules_signature:
        return

    with _PRODUCT_POI_MAP_LOCK:
        if _PRODUCT_POI_MAP_SIGNATURE == rules_signature:
            return
        refresh_product_poi_map(db, rules_signature)
        db.commit()


def get_poi_product_ids_query(db, poi_names):
    ensure_product_poi_map(db)
    query = db.query(models.ProductPoiMap.product_id)
    if poi_names:
        query = query.filter(models.ProductPoiMap.poi_name.in_(poi_names))
    return query


def get_pois(db, start_date=None, end_date=None):
    ensure_product_poi_map(db)
    query = db.query(models.ProductPoiMap.poi_name).distinct()
    if start_date and end_date:
        has_data_in_range = db.query(models.DailyProductSummary.product_id).filter(
            models.DailyProductSummary.product_id == models.ProductPoiMap.product_id,
            models.DailyProductSummary.date >= start_date,
            models.DailyProductSummary.date <= end_date,
        ).exists()
        query = query.filter(has_data_in_range)
    available_pois = {poi_name for poi_name, in query.all()}

    return [
        {"id": rule["name"], "name": rule["name"]}
        for rule in POI_INDEX.get_rules()
        if rule["name"] in available_pois
    ]


def get_product_ids_for_pois(db, poi_names):
    if not poi_names:
        return []

    return [
        product_id
        for product_id, in get_poi_product_ids_query(db, list(poi_names)).all()
    ]


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

COMPARE_WEIGHT_FIELDS = {
    "bounce_rate": "visitor_count",
    "silent_pay_conversion": "visitor_count",
    "live_consume_rate": "live_pay_users",
    "price_multiplier": "pay_users",
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


def get_compare_metric_sum_fields(metric):
    source_metric = COMPARE_SHARE_METRICS.get(metric, metric)
    return [source_metric, *COMPARE_TOTAL_DEPENDENCIES.get(metric, ())]

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
    _CACHE_TTL = 60

    def __init__(self):
        self._all_products = None
        self._range_products = {}
        self._loaded_at = 0

    def clear(self):
        self._all_products = None
        self._range_products = {}
        self._loaded_at = 0

    def _is_stale(self):
        return self._all_products is None or (time.monotonic() - self._loaded_at) > self._CACHE_TTL

    def _load_all_products(self, db):
        self._all_products = sorted([
            {"id": product_id, "name": product_name}
            for product_id, product_name in db.query(models.Product.id, models.Product.name).all()
        ], key=lambda item: item["name"])
        self._range_products = {}
        self._loaded_at = time.monotonic()

    def get_products(self, db, start_date=None, end_date=None):
        if self._is_stale():
            self._load_all_products(db)

        if not start_date or not end_date:
            return list(self._all_products)

        start_str = start_date.strftime("%Y-%m-%d") if hasattr(start_date, "strftime") else str(start_date)
        end_str = end_date.strftime("%Y-%m-%d") if hasattr(end_date, "strftime") else str(end_date)
        cache_key = (start_str, end_str)
        if cache_key not in self._range_products:
            rows = db.query(
                models.Product.id,
                models.Product.name,
            ).join(
                models.DailyProductSummary,
                models.DailyProductSummary.product_id == models.Product.id,
            ).filter(
                models.DailyProductSummary.date >= start_date,
                models.DailyProductSummary.date <= end_date,
            ).group_by(
                models.Product.id,
                models.Product.name,
            ).order_by(
                models.Product.name.asc(),
            ).all()

            self._range_products[cache_key] = [
                {"id": product_id, "name": product_name}
                for product_id, product_name in rows
            ]

        return list(self._range_products[cache_key])


PRODUCT_INDEX = ProductDateIndex()


def safe_divide(numerator, denominator, multiplier=1):
    if not denominator:
        return 0.0
    return float(numerator or 0) / float(denominator) * multiplier


def compute_display_metric_value(metric, sum_values, avg_values, denominator_values=None):
    share_source_metric = COMPARE_SHARE_METRICS.get(metric)
    if share_source_metric:
        return safe_divide(
            sum_values.get(share_source_metric),
            (denominator_values or {}).get(share_source_metric),
            100,
        )
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
    global DATA_CHANGE_VERSION
    DATA_CHANGE_VERSION += 1
    PRODUCT_INDEX.clear()
    POI_INDEX.clear()
    with _RESPONSE_CACHE_LOCK:
        _RESPONSE_CACHE.clear()


def get_data_change_version():
    return DATA_CHANGE_VERSION


def _freeze_cache_key(value):
    if isinstance(value, dict):
        return tuple(
            (key, _freeze_cache_key(value[key]))
            for key in sorted(value)
        )
    if isinstance(value, set):
        return tuple(sorted(_freeze_cache_key(item) for item in value))
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_cache_key(item) for item in value)
    return value


def get_response_cache_token():
    poi_signature = get_poi_rules_signature()
    return DATA_CHANGE_VERSION, poi_signature[1], poi_signature[2]


def get_cached_response(scope, key, builder, ttl=60):
    cache_key = (get_response_cache_token(), scope, _freeze_cache_key(key))
    now = time.monotonic()
    with _RESPONSE_CACHE_LOCK:
        cached = _RESPONSE_CACHE.get(cache_key)
        if cached and now - cached["stored_at"] < ttl:
            return cached["value"]

    value = builder()

    with _RESPONSE_CACHE_LOCK:
        _RESPONSE_CACHE[cache_key] = {
            "stored_at": time.monotonic(),
            "value": value,
        }
        if len(_RESPONSE_CACHE) > 256:
            expired_before = time.monotonic() - ttl
            for existing_key, existing_value in list(_RESPONSE_CACHE.items()):
                if existing_value["stored_at"] < expired_before:
                    del _RESPONSE_CACHE[existing_key]

    return value


def _create_compare_bucket(sum_metrics):
    return {
        "sum_values": {metric: 0.0 for metric in sum_metrics},
        "weighted_numerators": {},
        "weighted_denominators": {},
    }


def _accumulate_compare_bucket(bucket, row, sum_metrics, selected_metrics):
    for metric in sum_metrics:
        bucket["sum_values"][metric] += float(getattr(row, metric) or 0)

    for metric in selected_metrics:
        weight_field = COMPARE_WEIGHT_FIELDS.get(metric)
        if not weight_field:
            continue

        weight_value = float(getattr(row, weight_field) or 0)
        metric_value = float(getattr(row, metric) or 0)
        bucket["weighted_numerators"][metric] = bucket["weighted_numerators"].get(metric, 0.0) + metric_value * weight_value
        bucket["weighted_denominators"][metric] = bucket["weighted_denominators"].get(metric, 0.0) + weight_value


def _compute_compare_avg_values(bucket, selected_metrics):
    avg_values = {}
    for metric in selected_metrics:
        if metric in NON_ADDITIVE_AVERAGE_FIELDS:
            denominator = bucket["weighted_denominators"].get(metric, 0.0)
            avg_values[metric] = (bucket["weighted_numerators"].get(metric, 0.0) / denominator) if denominator else 0.0
        else:
            avg_values[metric] = 0.0
    return avg_values


def _build_compare_group_order(group_by, poi_rules, group_name):
    if group_by == "poi":
        poi_order = {
            rule["name"]: index
            for index, rule in enumerate(poi_rules)
        }
        return (poi_order.get(group_name, float("inf")), group_name)
    return (group_name,)


def _empty_compare_dataset(sum_metrics, selected_range_day_count, group_by, poi_rules, selected_metrics):
    return {
        "groups": {},
        "overall_bucket": _create_compare_bucket(sum_metrics),
        "global_bucket": _create_compare_bucket(sum_metrics),
        "global_daily_buckets": {},
        "selected_range_day_count": selected_range_day_count,
        "sorted_dates": [],
        "group_by": group_by,
        "poi_rules": poi_rules,
        "selected_metrics": selected_metrics,
    }


def _build_compare_aggregate_columns(sum_metrics, selected_metrics):
    aggregate_columns = [
        func.sum(getattr(models.DailyProductSummary, metric)).label(f"sum__{metric}")
        for metric in sum_metrics
    ]

    for metric in selected_metrics:
        weight_field = COMPARE_WEIGHT_FIELDS.get(metric)
        if not weight_field:
            continue

        metric_column = func.coalesce(getattr(models.DailyProductSummary, metric), 0)
        weight_column = func.coalesce(getattr(models.DailyProductSummary, weight_field), 0)
        aggregate_columns.extend([
            func.sum(metric_column * weight_column).label(f"weighted_numerator__{metric}"),
            func.sum(weight_column).label(f"weighted_denominator__{metric}"),
        ])

    return aggregate_columns


def _accumulate_compare_aggregate_row(bucket, row, sum_metrics, selected_metrics):
    row_values = row._mapping
    for metric in sum_metrics:
        bucket["sum_values"][metric] += float(row_values.get(f"sum__{metric}") or 0)

    for metric in selected_metrics:
        weight_field = COMPARE_WEIGHT_FIELDS.get(metric)
        if not weight_field:
            continue

        bucket["weighted_numerators"][metric] = (
            bucket["weighted_numerators"].get(metric, 0.0)
            + float(row_values.get(f"weighted_numerator__{metric}") or 0)
        )
        bucket["weighted_denominators"][metric] = (
            bucket["weighted_denominators"].get(metric, 0.0)
            + float(row_values.get(f"weighted_denominator__{metric}") or 0)
        )


def prepare_compare_dataset(
    db,
    start_date,
    end_date,
    selected_metrics,
    group_by="product",
    product_ids=None,
    poi_names=None,
):
    if group_by not in {"product", "poi"}:
        raise HTTPException(status_code=400, detail="Invalid compare group type")

    parsed_product_ids = list(product_ids or [])
    parsed_poi_names = list(poi_names or [])
    if parsed_product_ids and parsed_poi_names:
        raise HTTPException(status_code=400, detail="Product and POI filters cannot be combined")

    if group_by == "poi" and parsed_product_ids:
        raise HTTPException(status_code=400, detail="POI compare mode does not accept product filters")

    sum_metrics = list(dict.fromkeys(
        metric
        for selected_metric in selected_metrics
        for metric in get_compare_metric_sum_fields(selected_metric)
    ))
    selected_range_day_count = (end_date - start_date).days + 1
    needs_share_metrics = any(metric in COMPARE_SHARE_METRICS for metric in selected_metrics)

    poi_rules = []
    query_product_ids = None
    if group_by == "poi":
        ensure_product_poi_map(db)
        poi_rules = POI_INDEX.get_rules()
        if parsed_poi_names:
            has_matching_pois = db.query(models.ProductPoiMap.product_id).filter(
                models.ProductPoiMap.poi_name.in_(parsed_poi_names),
            ).first()
            if not has_matching_pois:
                return _empty_compare_dataset(sum_metrics, selected_range_day_count, group_by, poi_rules, selected_metrics)
    else:
        if parsed_poi_names:
            query_product_ids = get_product_ids_for_pois(db, parsed_poi_names)
            if not query_product_ids:
                return _empty_compare_dataset(sum_metrics, selected_range_day_count, group_by, poi_rules, selected_metrics)
        elif parsed_product_ids:
            query_product_ids = parsed_product_ids

    if query_product_ids is not None and not query_product_ids:
        return _empty_compare_dataset(sum_metrics, selected_range_day_count, group_by, poi_rules, selected_metrics)

    groups = {}
    overall_bucket = _create_compare_bucket(sum_metrics)
    global_bucket = _create_compare_bucket(sum_metrics)
    global_daily_buckets = {}
    distinct_dates = set()
    aggregate_columns = _build_compare_aggregate_columns(sum_metrics, selected_metrics)

    if needs_share_metrics:
        global_query = db.query(
            models.DailyProductSummary.date.label("date"),
            *aggregate_columns,
        ).filter(
            models.DailyProductSummary.date >= start_date,
            models.DailyProductSummary.date <= end_date,
        )

        if group_by == "poi":
            global_query = global_query.join(
                models.ProductPoiMap,
                models.DailyProductSummary.product_id == models.ProductPoiMap.product_id,
            )

        for global_row in global_query.group_by(models.DailyProductSummary.date).all():
            daily_global_bucket = global_daily_buckets.setdefault(
                global_row.date,
                _create_compare_bucket(sum_metrics),
            )
            _accumulate_compare_aggregate_row(global_bucket, global_row, sum_metrics, selected_metrics)
            _accumulate_compare_aggregate_row(daily_global_bucket, global_row, sum_metrics, selected_metrics)

    if group_by == "poi":
        query = db.query(
            models.ProductPoiMap.poi_name.label("group_key"),
            models.ProductPoiMap.poi_name.label("group_name"),
            models.DailyProductSummary.date.label("date"),
            *aggregate_columns,
        ).join(
            models.ProductPoiMap,
            models.DailyProductSummary.product_id == models.ProductPoiMap.product_id,
        ).filter(
            models.DailyProductSummary.date >= start_date,
            models.DailyProductSummary.date <= end_date,
        )
        if parsed_poi_names:
            query = query.filter(models.ProductPoiMap.poi_name.in_(parsed_poi_names))
        query = query.group_by(
            models.ProductPoiMap.poi_name,
            models.DailyProductSummary.date,
        )
    else:
        query = db.query(
            models.DailyProductSummary.product_id.label("group_key"),
            models.Product.name.label("group_name"),
            models.DailyProductSummary.date.label("date"),
            *aggregate_columns,
        ).join(
            models.Product,
            models.DailyProductSummary.product_id == models.Product.id,
        ).filter(
            models.DailyProductSummary.date >= start_date,
            models.DailyProductSummary.date <= end_date,
        )
        if query_product_ids is not None:
            query = apply_product_filter(query, query_product_ids, models.DailyProductSummary)
        query = query.group_by(
            models.DailyProductSummary.product_id,
            models.Product.name,
            models.DailyProductSummary.date,
        )

    for row in query.all():
        distinct_dates.add(row.date)
        group_entry = groups.setdefault(row.group_key, {
            "group_key": row.group_key,
            "group_name": row.group_name,
            "days": set(),
            "bucket": _create_compare_bucket(sum_metrics),
            "daily": {},
        })
        group_entry["days"].add(row.date)

        daily_bucket = group_entry["daily"].setdefault(
            row.date,
            _create_compare_bucket(sum_metrics),
        )

        _accumulate_compare_aggregate_row(group_entry["bucket"], row, sum_metrics, selected_metrics)
        _accumulate_compare_aggregate_row(daily_bucket, row, sum_metrics, selected_metrics)
        _accumulate_compare_aggregate_row(overall_bucket, row, sum_metrics, selected_metrics)

    return {
        "groups": groups,
        "overall_bucket": overall_bucket,
        "global_bucket": global_bucket,
        "global_daily_buckets": global_daily_buckets,
        "selected_range_day_count": selected_range_day_count,
        "sorted_dates": sorted(distinct_dates),
        "group_by": group_by,
        "poi_rules": poi_rules,
        "selected_metrics": selected_metrics,
    }


def build_compare_aggregate_payload_from_dataset(dataset, selected_metrics=None):
    selected_metrics = list(selected_metrics or dataset["selected_metrics"])
    selected_range_day_count = dataset["selected_range_day_count"]
    overall_avg_values = _compute_compare_avg_values(dataset["overall_bucket"], selected_metrics)
    overall_totals = {
        metric: compute_display_metric_value(
            metric,
            dataset["overall_bucket"]["sum_values"],
            overall_avg_values,
            dataset["global_bucket"]["sum_values"],
        )
        for metric in selected_metrics
    }

    rows = []
    sorted_groups = sorted(
        dataset["groups"].values(),
        key=lambda group: _build_compare_group_order(dataset["group_by"], dataset["poi_rules"], group["group_name"]),
    )

    for group_entry in sorted_groups:
        row = {
            "group_key": group_entry["group_key"],
            "group_name": group_entry["group_name"],
            "days_count": len(group_entry["days"]),
        }
        if dataset["group_by"] == "product":
            row["product_id"] = group_entry["group_key"]
            row["product_name"] = group_entry["group_name"]
        else:
            row["poi_name"] = group_entry["group_name"]

        group_avg_values = _compute_compare_avg_values(group_entry["bucket"], selected_metrics)
        daily_metric_sums = {metric: 0.0 for metric in selected_metrics}

        for target_date, daily_bucket in group_entry["daily"].items():
            daily_avg_values = _compute_compare_avg_values(daily_bucket, selected_metrics)
            daily_global_bucket = dataset["global_daily_buckets"].get(target_date)
            daily_denominator_values = daily_global_bucket["sum_values"] if daily_global_bucket else {}
            for metric in selected_metrics:
                daily_metric_sums[metric] += compute_display_metric_value(
                    metric,
                    daily_bucket["sum_values"],
                    daily_avg_values,
                    daily_denominator_values,
                )

        for metric in selected_metrics:
            row[f"{metric}_avg"] = (
                daily_metric_sums[metric] / selected_range_day_count if selected_range_day_count > 0 else 0.0
            )
            row[f"{metric}_total"] = compute_display_metric_value(
                metric,
                group_entry["bucket"]["sum_values"],
                group_avg_values,
                dataset["global_bucket"]["sum_values"],
            )

        rows.append(row)

    return {
        "rows": rows,
        "overall_totals": overall_totals,
        "selected_range_day_count": selected_range_day_count,
        "group_by": dataset["group_by"],
    }


def build_compare_aggregate_payload(
    db,
    start_date,
    end_date,
    selected_metrics,
    group_by="product",
    product_ids=None,
    poi_names=None,
):
    dataset = prepare_compare_dataset(
        db=db,
        start_date=start_date,
        end_date=end_date,
        selected_metrics=selected_metrics,
        group_by=group_by,
        product_ids=product_ids,
        poi_names=poi_names,
    )
    return build_compare_aggregate_payload_from_dataset(dataset, selected_metrics)


def compute_compare_overall_metric(
    db,
    start_date,
    end_date,
    metric,
    product_ids=None,
    poi_names=None,
    poi_scope=False,
):
    selected_metric = parse_compare_metrics(metric)[0]
    parsed_poi_names = list(poi_names or [])
    parsed_product_ids = list(product_ids or [])
    if parsed_poi_names and parsed_product_ids:
        raise HTTPException(status_code=400, detail="Product and POI filters cannot be combined")

    if parsed_poi_names or poi_scope:
        ensure_product_poi_map(db)
        if parsed_poi_names:
            has_matching_pois = db.query(models.ProductPoiMap.product_id).filter(
                models.ProductPoiMap.poi_name.in_(parsed_poi_names),
            ).first()
            if not has_matching_pois:
                return 0.0
    elif product_ids is not None and not parsed_product_ids:
        return 0.0

    sum_metrics = list(dict.fromkeys(get_compare_metric_sum_fields(selected_metric)))
    aggregate_columns = _build_compare_aggregate_columns(sum_metrics, [selected_metric])

    global_bucket = _create_compare_bucket(sum_metrics)
    if selected_metric in COMPARE_SHARE_METRICS:
        global_query = db.query(*aggregate_columns).filter(
            models.DailyProductSummary.date >= start_date,
            models.DailyProductSummary.date <= end_date,
        )
        if parsed_poi_names or poi_scope:
            global_query = global_query.join(
                models.ProductPoiMap,
                models.DailyProductSummary.product_id == models.ProductPoiMap.product_id,
            )
        global_row = global_query.first()
        if global_row is not None:
            _accumulate_compare_aggregate_row(global_bucket, global_row, sum_metrics, [selected_metric])

    query = db.query(*aggregate_columns).filter(
        models.DailyProductSummary.date >= start_date,
        models.DailyProductSummary.date <= end_date,
    )
    if parsed_poi_names or poi_scope:
        query = query.join(
            models.ProductPoiMap,
            models.DailyProductSummary.product_id == models.ProductPoiMap.product_id,
        )
        if parsed_poi_names:
            query = query.filter(models.ProductPoiMap.poi_name.in_(parsed_poi_names))
    elif product_ids is not None:
        query = apply_product_filter(query, parsed_product_ids, models.DailyProductSummary)

    row = query.first()
    if row is None:
        return 0.0

    bucket = _create_compare_bucket(sum_metrics)
    _accumulate_compare_aggregate_row(bucket, row, sum_metrics, [selected_metric])
    avg_values = _compute_compare_avg_values(bucket, [selected_metric])
    denominator_values = global_bucket["sum_values"] if selected_metric in COMPARE_SHARE_METRICS else None
    return compute_display_metric_value(
        selected_metric,
        bucket["sum_values"],
        avg_values,
        denominator_values,
    )


def _month_date_bounds(month):
    year_text, month_text = month.split("-")
    year = int(year_text)
    month_number = int(month_text)
    last_day = calendar.monthrange(year, month_number)[1]
    return date(year, month_number, 1), date(year, month_number, last_day)


def compute_compare_overall_metrics_by_month(
    db,
    months,
    metric,
    product_ids=None,
    poi_names=None,
    poi_scope=False,
):
    selected_metric = parse_compare_metrics(metric)[0]
    parsed_months = list(dict.fromkeys(months or []))
    if not parsed_months:
        return {}

    parsed_product_ids = list(product_ids or [])
    parsed_poi_names = list(poi_names or [])
    if parsed_poi_names and parsed_product_ids:
        raise HTTPException(status_code=400, detail="Product and POI filters cannot be combined")
    if product_ids is not None and not parsed_product_ids:
        return {month: 0.0 for month in parsed_months}

    if parsed_poi_names or poi_scope:
        ensure_product_poi_map(db)
        if parsed_poi_names:
            has_matching_pois = db.query(models.ProductPoiMap.product_id).filter(
                models.ProductPoiMap.poi_name.in_(parsed_poi_names),
            ).first()
            if not has_matching_pois:
                return {month: 0.0 for month in parsed_months}

    month_ranges = [_month_date_bounds(month) for month in parsed_months]
    min_start = min(start_date for start_date, _ in month_ranges)
    max_end = max(end_date for _, end_date in month_ranges)
    month_key_set = set(parsed_months)
    month_expr = func.strftime("%Y-%m", models.DailyProductSummary.date)
    sum_metrics = list(dict.fromkeys(get_compare_metric_sum_fields(selected_metric)))
    aggregate_columns = _build_compare_aggregate_columns(sum_metrics, [selected_metric])

    def build_month_query(apply_scope_filter):
        query = db.query(
            month_expr.label("month_key"),
            *aggregate_columns,
        ).filter(
            models.DailyProductSummary.date >= min_start,
            models.DailyProductSummary.date <= max_end,
        )

        if parsed_poi_names or poi_scope:
            query = query.join(
                models.ProductPoiMap,
                models.DailyProductSummary.product_id == models.ProductPoiMap.product_id,
            )
            if apply_scope_filter and parsed_poi_names:
                query = query.filter(models.ProductPoiMap.poi_name.in_(parsed_poi_names))
        elif apply_scope_filter and product_ids is not None:
            query = apply_product_filter(query, parsed_product_ids, models.DailyProductSummary)

        return query.group_by(month_expr)

    global_buckets = {}
    if selected_metric in COMPARE_SHARE_METRICS:
        for row in build_month_query(apply_scope_filter=False).all():
            if row.month_key not in month_key_set:
                continue
            bucket = _create_compare_bucket(sum_metrics)
            _accumulate_compare_aggregate_row(bucket, row, sum_metrics, [selected_metric])
            global_buckets[row.month_key] = bucket

    values_by_month = {}
    for row in build_month_query(apply_scope_filter=True).all():
        if row.month_key not in month_key_set:
            continue
        bucket = _create_compare_bucket(sum_metrics)
        _accumulate_compare_aggregate_row(bucket, row, sum_metrics, [selected_metric])
        avg_values = _compute_compare_avg_values(bucket, [selected_metric])
        denominator_values = (
            global_buckets.get(row.month_key, _create_compare_bucket(sum_metrics))["sum_values"]
            if selected_metric in COMPARE_SHARE_METRICS
            else None
        )
        values_by_month[row.month_key] = compute_display_metric_value(
            selected_metric,
            bucket["sum_values"],
            avg_values,
            denominator_values,
        )

    return {
        month: float(values_by_month.get(month) or 0)
        for month in parsed_months
    }


def build_compare_trend_payload(
    db,
    start_date,
    end_date,
    metric,
    group_by="product",
    product_ids=None,
    poi_names=None,
):
    return build_compare_trends_payload(
        db=db,
        start_date=start_date,
        end_date=end_date,
        selected_metrics=[metric],
        group_by=group_by,
        product_ids=product_ids,
        poi_names=poi_names,
    )[metric]


def build_compare_trends_payload(
    db,
    start_date,
    end_date,
    selected_metrics,
    group_by="product",
    product_ids=None,
    poi_names=None,
    group_keys_by_metric=None,
):
    dataset = prepare_compare_dataset(
        db=db,
        start_date=start_date,
        end_date=end_date,
        selected_metrics=selected_metrics,
        group_by=group_by,
        product_ids=product_ids,
        poi_names=poi_names,
    )
    return build_compare_trends_payload_from_dataset(
        dataset,
        selected_metrics,
        group_keys_by_metric=group_keys_by_metric,
    )


def build_compare_trends_payload_from_dataset(
    dataset,
    selected_metrics,
    group_keys_by_metric=None,
):
    sorted_groups = sorted(
        dataset["groups"].values(),
        key=lambda group: _build_compare_group_order(dataset["group_by"], dataset["poi_rules"], group["group_name"]),
    )
    trend_payloads = {}

    for metric in selected_metrics:
        allowed_group_keys = None
        if group_keys_by_metric and group_keys_by_metric.get(metric):
            allowed_group_keys = set(group_keys_by_metric[metric])

        trend_rows = []
        for group_entry in sorted_groups:
            if allowed_group_keys is not None and group_entry["group_key"] not in allowed_group_keys:
                continue
            for target_date in sorted(group_entry["daily"]):
                daily_bucket = group_entry["daily"][target_date]
                daily_avg_values = _compute_compare_avg_values(daily_bucket, [metric])
                daily_global_bucket = dataset["global_daily_buckets"].get(target_date)
                daily_denominator_values = daily_global_bucket["sum_values"] if daily_global_bucket else {}
                row = {
                    "group_key": group_entry["group_key"],
                    "group_name": group_entry["group_name"],
                    "date": target_date.strftime("%Y-%m-%d"),
                    "value": compute_display_metric_value(
                        metric,
                        daily_bucket["sum_values"],
                        daily_avg_values,
                        daily_denominator_values,
                    ),
                }
                if dataset["group_by"] == "product":
                    row["product_id"] = group_entry["group_key"]
                    row["product_name"] = group_entry["group_name"]
                else:
                    row["poi_name"] = group_entry["group_name"]
                trend_rows.append(row)

        trend_payloads[metric] = {
            "dates": [target_date.strftime("%Y-%m-%d") for target_date in dataset["sorted_dates"]],
            "rows": trend_rows,
            "group_by": dataset["group_by"],
        }

    return trend_payloads


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


def refresh_materialized_summaries_for_dates(db, target_dates):
    for target_date in sorted(set(target_dates)):
        refresh_materialized_summaries(db, target_date)


def ensure_daily_summaries():
    db = SessionLocal()
    try:
        data_dates = {
            row[0]
            for row in db.query(models.DailyData.date).distinct().all()
            if row[0] is not None
        }
        summary_dates = {
            row[0]
            for row in db.query(models.DailySummary.date).all()
            if row[0] is not None
        }

        stale_dates = data_dates - summary_dates
        extra_dates = summary_dates - data_dates
        if not stale_dates and not extra_dates:
            return

        if extra_dates:
            db.query(models.DailySummary).filter(
                models.DailySummary.date.in_(extra_dates)
            ).delete(synchronize_session=False)
        for target_date in stale_dates:
            refresh_daily_summary(db, target_date)
        db.commit()
    finally:
        db.close()


def ensure_daily_product_summaries():
    db = SessionLocal()
    try:
        data_counts = {
            row.date: row.count
            for row in db.query(
                models.DailyData.date.label("date"),
                func.count(models.DailyData.id).label("count"),
            ).group_by(models.DailyData.date).all()
            if row.date is not None
        }
        summary_counts = {
            row.date: row.count
            for row in db.query(
                models.DailyProductSummary.date.label("date"),
                func.count().label("count"),
            ).group_by(models.DailyProductSummary.date).all()
            if row.date is not None
        }

        data_dates = set(data_counts)
        summary_dates = set(summary_counts)
        stale_dates = {
            target_date
            for target_date, data_count in data_counts.items()
            if summary_counts.get(target_date) != data_count
        }
        extra_dates = summary_dates - data_dates
        if not stale_dates and not extra_dates:
            return

        if extra_dates:
            db.query(models.DailyProductSummary).filter(
                models.DailyProductSummary.date.in_(extra_dates)
            ).delete(synchronize_session=False)
        for target_date in stale_dates:
            refresh_daily_product_summary(db, target_date)
        db.commit()
    finally:
        db.close()


def _rank_items(items, limit):
    return [
        {
            "rank": index + 1,
            "id": item["id"],
            "name": item["name"],
            "value": float(item["value"] or 0),
        }
        for index, item in enumerate(items[:limit])
    ]


def build_product_metric_ranking(db, start_date, end_date, metric, limit=5):
    metric_column = getattr(models.DailyProductSummary, metric)
    metric_sum = func.sum(metric_column)
    rows = db.query(
        models.DailyProductSummary.product_id,
        models.Product.name.label("product_name"),
        metric_sum.label("value"),
    ).join(
        models.Product,
        models.DailyProductSummary.product_id == models.Product.id,
    ).filter(
        models.DailyProductSummary.date >= start_date,
        models.DailyProductSummary.date <= end_date,
    ).group_by(
        models.DailyProductSummary.product_id,
        models.Product.name,
    ).having(
        metric_sum > 0
    ).order_by(
        metric_sum.desc()
    ).limit(limit).all()

    return _rank_items([
        {
            "id": product_id,
            "name": product_name,
            "value": value,
        }
        for product_id, product_name, value in rows
    ], limit)


def build_poi_metric_ranking(db, start_date, end_date, metric, limit=5):
    ensure_product_poi_map(db)
    metric_column = getattr(models.DailyProductSummary, metric)
    metric_sum = func.sum(metric_column)
    rows = db.query(
        models.ProductPoiMap.poi_name,
        metric_sum.label("value"),
    ).join(
        models.ProductPoiMap,
        models.DailyProductSummary.product_id == models.ProductPoiMap.product_id,
    ).filter(
        models.DailyProductSummary.date >= start_date,
        models.DailyProductSummary.date <= end_date,
    ).group_by(
        models.ProductPoiMap.poi_name,
    ).having(
        metric_sum > 0
    ).order_by(
        metric_sum.desc()
    ).limit(limit).all()

    return _rank_items(
        [
            {
                "id": poi_name,
                "name": poi_name,
                "value": value,
            }
            for poi_name, value in rows
        ],
        limit,
    )


def build_summary_rankings(db, start_date, end_date, limit=5):
    return {
        "pay_amount_products": build_product_metric_ranking(db, start_date, end_date, "pay_amount", limit),
        "pay_amount_pois": build_poi_metric_ranking(db, start_date, end_date, "pay_amount", limit),
        "refund_amount_products": build_product_metric_ranking(db, start_date, end_date, "refund_amount", limit),
    }


def compute_total_rate(db, start_date, end_date, product_ids=None):
    if product_ids:
        result = db.query(
            func.sum(models.DailyProductSummary.pay_amount).label("pay_amount"),
            func.sum(models.DailyProductSummary.pay_orders).label("pay_orders"),
            func.sum(models.DailyProductSummary.pay_items).label("pay_items"),
            func.sum(models.DailyProductSummary.redeem_items).label("redeem_items"),
            func.sum(models.DailyProductSummary.redeem_amount).label("redeem_amount"),
            func.sum(models.DailyProductSummary.refund_amount).label("refund_amount"),
            func.sum(models.DailyProductSummary.refund_items).label("refund_items"),
            func.sum(models.DailyProductSummary.live_refund_amount).label("live_refund_amount"),
            func.sum(models.DailyProductSummary.live_consume_amount).label("live_consume_amount"),
            func.sum(models.DailyProductSummary.profit).label("profit"),
        ).filter(
            models.DailyProductSummary.date >= start_date,
            models.DailyProductSummary.date <= end_date,
        )
        result = apply_product_filter(result, product_ids, models.DailyProductSummary).first()
    else:
        result = db.query(
            func.sum(models.DailySummary.pay_amount).label("pay_amount"),
            func.sum(models.DailySummary.pay_orders).label("pay_orders"),
            func.sum(models.DailySummary.pay_items).label("pay_items"),
            func.sum(models.DailySummary.redeem_items).label("redeem_items"),
            func.sum(models.DailySummary.redeem_amount).label("redeem_amount"),
            func.sum(models.DailySummary.refund_amount).label("refund_amount"),
            func.sum(models.DailySummary.refund_items).label("refund_items"),
            func.sum(models.DailySummary.live_refund_amount).label("live_refund_amount"),
            func.sum(models.DailySummary.live_consume_amount).label("live_consume_amount"),
            func.sum(models.DailySummary.profit).label("profit"),
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
        "profit_margin": profit_margin,
    }


def build_summary_payload(db, start_date, end_date, product_ids=None, poi_names=None):
    parsed_product_ids = list(product_ids or [])
    parsed_poi_names = list(poi_names or [])
    if parsed_product_ids and parsed_poi_names:
        raise HTTPException(status_code=400, detail="Product and POI filters cannot be combined")

    if parsed_poi_names:
        parsed_product_ids = get_product_ids_for_pois(db, parsed_poi_names)
        if not parsed_product_ids:
            return {"today": None, "yesterday": None, "has_yesterday": False}

    calc_today = compute_total_rate(db, start_date, end_date, parsed_product_ids)
    if not calc_today:
        return {"today": None, "yesterday": None, "has_yesterday": False}

    delta_days = (end_date - start_date).days + 1
    prev_end_dt = start_date - timedelta(days=1)
    prev_start_dt = start_date - timedelta(days=delta_days)

    calc_yesterday = compute_total_rate(db, prev_start_dt, prev_end_dt, parsed_product_ids)

    changes = {}
    if calc_yesterday:
        for key in calc_today:
            old_val = calc_yesterday[key]
            new_val = calc_today[key]
            if old_val == 0:
                changes[key] = 100.0 if new_val > 0 else 0.0
            else:
                changes[key] = ((new_val - old_val) / abs(old_val)) * 100

    return {
        "today": calc_today,
        "yesterday": calc_yesterday,
        "changes": changes,
        "has_yesterday": bool(calc_yesterday),
    }


def build_compare_report_payload(
    db,
    start_date,
    end_date,
    selected_metrics,
    group_by="product",
    product_ids=None,
    poi_names=None,
    trend_metric=None,
    trend_limit=5,
):
    report_metrics = list(dict.fromkeys([
        *selected_metrics,
        *([trend_metric] if trend_metric else []),
    ]))
    dataset = prepare_compare_dataset(
        db=db,
        start_date=start_date,
        end_date=end_date,
        selected_metrics=report_metrics,
        group_by=group_by,
        product_ids=product_ids,
        poi_names=poi_names,
    )
    aggregate_payload = build_compare_aggregate_payload_from_dataset(dataset, selected_metrics)
    summary_payload = build_summary_payload(
        db=db,
        start_date=start_date,
        end_date=end_date,
        product_ids=product_ids,
        poi_names=poi_names,
    )

    trend_payload = {"dates": [], "rows": [], "group_by": group_by}
    if trend_metric:
        safe_trend_limit = max(1, min(int(trend_limit or 5), 20))
        top_group_keys = [
            row["group_key"]
            for row in sorted(
                aggregate_payload.get("rows") or [],
                key=lambda item: float(item.get(f"{trend_metric}_total") or 0),
                reverse=True,
            )[:safe_trend_limit]
        ]
        if top_group_keys:
            trend_payload = build_compare_trends_payload_from_dataset(
                dataset,
                [trend_metric],
                group_keys_by_metric={trend_metric: top_group_keys},
            )[trend_metric]

    return {
        "aggregate": aggregate_payload,
        "summary": summary_payload,
        "trend": trend_payload,
    }

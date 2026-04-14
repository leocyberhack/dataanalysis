import hashlib
import os
import re
import time
from collections import defaultdict
from pathlib import Path

import pandas as pd
from fastapi import HTTPException
from sqlalchemy import func, text

import models
from database import engine, SessionLocal


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

        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_products_name ON products (name)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_data_product_id_date ON daily_data (product_id, date)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pending_orders_status_date_id ON pending_orders (status, date, id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_product_summaries_date_product_id ON daily_product_summaries (date, product_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_product_summaries_product_id_date ON daily_product_summaries (product_id, date)"))
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
            if keyword_group:
                keywords = [
                    item.strip()
                    for item in POI_KEYWORD_SPLIT_PATTERN.split(keyword_group)
                    if item.strip()
                ]
            else:
                keywords = [poi_name]

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


def get_pois(db, start_date=None, end_date=None):
    products = PRODUCT_INDEX.get_products(db, start_date, end_date) if start_date and end_date else PRODUCT_INDEX.get_products(db)
    poi_mapping = build_product_poi_map(products)
    available_pois = set(poi_mapping["poi_to_product_ids"])

    return [
        {"id": rule["name"], "name": rule["name"]}
        for rule in poi_mapping["rules"]
        if rule["name"] in available_pois
    ]


def get_product_ids_for_pois(db, poi_names):
    if not poi_names:
        return []

    poi_name_set = set(poi_names)
    products = PRODUCT_INDEX.get_products(db)
    poi_mapping = build_product_poi_map(products)

    return [
        product_id
        for product_id, poi_name in poi_mapping["product_to_poi"].items()
        if poi_name in poi_name_set
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
                models.DailyProductSummary.date,
            ).join(
                models.Product,
                models.DailyProductSummary.product_id == models.Product.id,
            ).all()

            products_map = {}
            for pid, pname, pdt in results:
                try:
                    pdt_val = pdt.strftime("%Y-%m-%d")
                except AttributeError:
                    pdt_val = str(pdt)
                if pid not in products_map:
                    products_map[pid] = {"name": pname, "dates": set()}
                products_map[pid]["dates"].add(pdt_val)

            self._index = sorted([
                (pid, data["name"], data["dates"])
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
    if group_by == "product" and parsed_poi_names:
        raise HTTPException(status_code=400, detail="Product compare mode does not accept POI filters")

    sum_metrics = list(dict.fromkeys(
        metric
        for selected_metric in selected_metrics
        for metric in [selected_metric, *COMPARE_TOTAL_DEPENDENCIES.get(selected_metric, ())]
    ))
    selected_range_day_count = (end_date - start_date).days + 1

    poi_rules = []
    product_to_poi = {}
    query_product_ids = None
    if group_by == "poi":
        poi_rules = load_poi_rules()
        all_products = PRODUCT_INDEX.get_products(db)
        poi_mapping = build_product_poi_map(all_products, poi_rules)
        product_to_poi = poi_mapping["product_to_poi"]

        if parsed_poi_names:
            query_product_ids = [
                product_id
                for product_id, poi_name in product_to_poi.items()
                if poi_name in set(parsed_poi_names)
            ]
            if not query_product_ids:
                return {
                    "groups": {},
                    "overall_bucket": _create_compare_bucket(sum_metrics),
                    "selected_range_day_count": selected_range_day_count,
                    "sorted_dates": [],
                    "group_by": group_by,
                    "poi_rules": poi_rules,
                    "selected_metrics": selected_metrics,
                }
    elif parsed_product_ids:
        query_product_ids = parsed_product_ids

    query = db.query(
        models.DailyProductSummary,
        models.Product.name.label("product_name"),
    ).join(
        models.Product,
        models.DailyProductSummary.product_id == models.Product.id,
    ).filter(
        models.DailyProductSummary.date >= start_date,
        models.DailyProductSummary.date <= end_date,
    )

    if query_product_ids is not None:
        query = apply_product_filter(query, query_product_ids, models.DailyProductSummary)

    groups = {}
    overall_bucket = _create_compare_bucket(sum_metrics)
    distinct_dates = set()

    for daily_row, product_name in query.all():
        if group_by == "poi":
            group_name = product_to_poi.get(daily_row.product_id)
            if not group_name:
                continue
            group_key = group_name
        else:
            group_key = daily_row.product_id
            group_name = product_name

        distinct_dates.add(daily_row.date)
        group_entry = groups.setdefault(group_key, {
            "group_key": group_key,
            "group_name": group_name,
            "days": set(),
            "bucket": _create_compare_bucket(sum_metrics),
            "daily": {},
        })
        group_entry["days"].add(daily_row.date)

        daily_bucket = group_entry["daily"].setdefault(
            daily_row.date,
            _create_compare_bucket(sum_metrics),
        )

        _accumulate_compare_bucket(group_entry["bucket"], daily_row, sum_metrics, selected_metrics)
        _accumulate_compare_bucket(daily_bucket, daily_row, sum_metrics, selected_metrics)
        _accumulate_compare_bucket(overall_bucket, daily_row, sum_metrics, selected_metrics)

    return {
        "groups": groups,
        "overall_bucket": overall_bucket,
        "selected_range_day_count": selected_range_day_count,
        "sorted_dates": sorted(distinct_dates),
        "group_by": group_by,
        "poi_rules": poi_rules,
        "selected_metrics": selected_metrics,
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

    selected_range_day_count = dataset["selected_range_day_count"]
    overall_avg_values = _compute_compare_avg_values(dataset["overall_bucket"], selected_metrics)
    overall_totals = {
        metric: compute_display_metric_value(metric, dataset["overall_bucket"]["sum_values"], overall_avg_values)
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

        for daily_bucket in group_entry["daily"].values():
            daily_avg_values = _compute_compare_avg_values(daily_bucket, selected_metrics)
            for metric in selected_metrics:
                daily_metric_sums[metric] += compute_display_metric_value(metric, daily_bucket["sum_values"], daily_avg_values)

        for metric in selected_metrics:
            row[f"{metric}_avg"] = (
                daily_metric_sums[metric] / selected_range_day_count if selected_range_day_count > 0 else 0.0
            )
            row[f"{metric}_total"] = compute_display_metric_value(metric, group_entry["bucket"]["sum_values"], group_avg_values)

        rows.append(row)

    return {
        "rows": rows,
        "overall_totals": overall_totals,
        "selected_range_day_count": selected_range_day_count,
        "group_by": dataset["group_by"],
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
    dataset = prepare_compare_dataset(
        db=db,
        start_date=start_date,
        end_date=end_date,
        selected_metrics=[metric],
        group_by=group_by,
        product_ids=product_ids,
        poi_names=poi_names,
    )

    trend_rows = []
    sorted_groups = sorted(
        dataset["groups"].values(),
        key=lambda group: _build_compare_group_order(dataset["group_by"], dataset["poi_rules"], group["group_name"]),
    )

    for group_entry in sorted_groups:
        for target_date in sorted(group_entry["daily"]):
            daily_bucket = group_entry["daily"][target_date]
            daily_avg_values = _compute_compare_avg_values(daily_bucket, [metric])
            row = {
                "group_key": group_entry["group_key"],
                "group_name": group_entry["group_name"],
                "date": target_date.strftime("%Y-%m-%d"),
                "value": compute_display_metric_value(metric, daily_bucket["sum_values"], daily_avg_values),
            }
            if dataset["group_by"] == "product":
                row["product_id"] = group_entry["group_key"]
                row["product_name"] = group_entry["group_name"]
            else:
                row["poi_name"] = group_entry["group_name"]
            trend_rows.append(row)

    return {
        "dates": [target_date.strftime("%Y-%m-%d") for target_date in dataset["sorted_dates"]],
        "rows": trend_rows,
        "group_by": dataset["group_by"],
    }


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

import math
from copy import deepcopy

import numpy as np
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from deps import get_db
from services import get_data_change_version, get_product_ids_for_pois, parse_poi_names, safe_divide


router = APIRouter()
DEEP_ANALYSIS_CACHE = {}

FEATURES = [
    {"key": "visitor_count", "label": "访客数", "kind": "volume"},
    {"key": "bounce_rate", "label": "详情页跳出率", "kind": "rate"},
    {"key": "page_views", "label": "浏览量", "kind": "volume"},
    {"key": "redeem_rate_amount", "label": "核销率(金额)", "kind": "rate"},
    {"key": "refund_rate_amount", "label": "成功退款率(金额)", "kind": "rate"},
    {"key": "pay_amount", "label": "支付金额", "kind": "volume"},
]


def signed_log1p(value):
    numeric_value = float(value or 0)
    return math.copysign(math.log1p(abs(numeric_value)), numeric_value)


def transform_change(current_value, previous_value, kind):
    if kind == "rate":
        return float(current_value or 0) - float(previous_value or 0)
    return signed_log1p(current_value) - signed_log1p(previous_value)


def normalize_positive(values):
    array = np.array(values, dtype=float)
    array = np.where(np.isfinite(array), array, 0.0)
    array = np.clip(array, 0.0, None)
    total = float(array.sum())
    if total <= 1e-12:
        return np.zeros_like(array)
    return array / total


def fit_ridge_regression(x_train, y_train, alpha):
    feature_count = x_train.shape[1]
    regularizer = np.eye(feature_count) * alpha
    return np.linalg.pinv(x_train.T @ x_train + regularizer) @ x_train.T @ y_train


def choose_alpha(x_values, y_values):
    sample_count = x_values.shape[0]
    alpha_candidates = [0.01, 0.1, 0.3, 1.0, 3.0, 10.0, 30.0, 100.0]
    if sample_count < 4:
        return 10.0

    best_alpha = alpha_candidates[0]
    best_error = float("inf")
    for alpha in alpha_candidates:
        errors = []
        for holdout_index in range(sample_count):
            train_mask = np.ones(sample_count, dtype=bool)
            train_mask[holdout_index] = False
            coefficients = fit_ridge_regression(x_values[train_mask], y_values[train_mask], alpha)
            prediction = float(x_values[holdout_index] @ coefficients)
            errors.append((float(y_values[holdout_index]) - prediction) ** 2)
        mean_error = float(np.mean(errors))
        if mean_error < best_error:
            best_error = mean_error
            best_alpha = alpha
    return best_alpha


def get_valid_dual_dates(db):
    return sorted({
        row.date
        for row in db.query(models.DailySummary).filter(
            models.DailySummary.commodity_uploaded.is_(True),
            models.DailySummary.order_uploaded.is_(True),
        ).all()
    })


def build_cache_key(valid_dates, poi_names):
    scope_key = tuple(sorted(poi_names)) if poi_names else ("__all__",)
    date_key = tuple(date_value.strftime("%Y-%m-%d") for date_value in valid_dates)
    return get_data_change_version(), scope_key, date_key


def compute_daily_records(db, valid_dates, product_ids=None):
    if not valid_dates:
        return []

    visitor_count = func.coalesce(models.DailyProductSummary.visitor_count, 0)
    bounce_rate = func.coalesce(models.DailyProductSummary.bounce_rate, 0)
    pay_amount_column = func.coalesce(models.DailyProductSummary.pay_amount, 0)
    query = db.query(
        models.DailyProductSummary.date.label("date"),
        func.sum(visitor_count).label("visitor_count"),
        func.sum(bounce_rate * visitor_count).label("bounce_weighted_sum"),
        func.sum(visitor_count).label("bounce_weight"),
        func.sum(models.DailyProductSummary.page_views).label("page_views"),
        func.sum(models.DailyProductSummary.redeem_amount).label("redeem_amount"),
        func.sum(models.DailyProductSummary.refund_amount).label("refund_amount"),
        func.sum(pay_amount_column).label("pay_amount"),
        func.sum(models.DailyProductSummary.profit).label("profit"),
    ).filter(
        models.DailyProductSummary.date.in_(valid_dates),
    )
    if product_ids is not None:
        if not product_ids:
            return []
        query = query.filter(models.DailyProductSummary.product_id.in_(product_ids))

    records = []
    for row in query.group_by(models.DailyProductSummary.date).order_by(models.DailyProductSummary.date.asc()).all():
        pay_amount = float(row.pay_amount or 0)
        records.append({
            "date": row.date.strftime("%Y-%m-%d"),
            "visitor_count": float(row.visitor_count or 0),
            "bounce_rate": safe_divide(row.bounce_weighted_sum, row.bounce_weight),
            "page_views": float(row.page_views or 0),
            "redeem_rate_amount": safe_divide(row.redeem_amount, pay_amount, 100),
            "refund_rate_amount": safe_divide(row.refund_amount, pay_amount, 100),
            "pay_amount": pay_amount,
            "profit": float(row.profit or 0),
        })

    return records


def compute_feature_daily_averages(records):
    if not records:
        return {}

    day_count = len(records)
    return {
        feature["key"]: sum(float(row.get(feature["key"]) or 0) for row in records) / day_count
        for feature in FEATURES
    }


def build_change_matrix(records):
    x_rows = []
    y_values = []
    for index in range(1, len(records)):
        current = records[index]
        previous = records[index - 1]
        x_rows.append([
            transform_change(current[feature["key"]], previous[feature["key"]], feature["kind"])
            for feature in FEATURES
        ])
        y_values.append(signed_log1p(current["profit"]) - signed_log1p(previous["profit"]))
    return np.array(x_rows, dtype=float), np.array(y_values, dtype=float)


def analyze_feature_weights(records):
    x_raw, y_raw = build_change_matrix(records)
    sample_count = x_raw.shape[0]
    feature_count = len(FEATURES)

    if sample_count < 3:
        return None, "至少需要 4 个双数据齐全日期，才能形成 3 个以上变化样本。"
    if float(np.std(y_raw)) <= 1e-12:
        return None, "利润变化过小，暂时无法学习影响权重。"

    x_mean = x_raw.mean(axis=0)
    x_std = x_raw.std(axis=0)
    y_mean = y_raw.mean()
    y_std = y_raw.std()
    active_mask = x_std > 1e-12

    x_values = np.zeros_like(x_raw)
    x_values[:, active_mask] = (x_raw[:, active_mask] - x_mean[active_mask]) / x_std[active_mask]
    y_values = (y_raw - y_mean) / y_std

    alpha = choose_alpha(x_values, y_values)
    coefficients = fit_ridge_regression(x_values, y_values, alpha)
    predictions = x_values @ coefficients
    residuals = y_values - predictions
    baseline_mse = float(np.mean(residuals ** 2))
    total_variance = float(np.sum((y_values - y_values.mean()) ** 2))
    r2_score = 1 - float(np.sum(residuals ** 2)) / total_variance if total_variance > 1e-12 else 0

    permutation_importance = []
    max_shift = min(5, sample_count - 1)
    for feature_index in range(feature_count):
        if not active_mask[feature_index]:
            permutation_importance.append(0.0)
            continue
        deltas = []
        for shift in range(1, max_shift + 1):
            x_permuted = x_values.copy()
            x_permuted[:, feature_index] = np.roll(x_permuted[:, feature_index], shift)
            permuted_mse = float(np.mean((y_values - x_permuted @ coefficients) ** 2))
            deltas.append(max(permuted_mse - baseline_mse, 0.0))
        permutation_importance.append(float(np.mean(deltas)))

    correlations = []
    for feature_index in range(feature_count):
        if not active_mask[feature_index]:
            correlations.append(0.0)
            continue
        correlations.append(abs(float(np.corrcoef(x_values[:, feature_index], y_values)[0, 1])))

    feature_correlation = np.corrcoef(x_values, rowvar=False)
    feature_correlation = np.nan_to_num(np.abs(feature_correlation), nan=0.0, posinf=0.0, neginf=0.0)
    redundancy = []
    for feature_index in range(feature_count):
        other_values = np.delete(feature_correlation[feature_index], feature_index)
        redundancy.append(float(other_values.mean()) if len(other_values) else 0.0)

    coefficient_importance = normalize_positive(np.abs(coefficients))
    permutation_scores = normalize_positive(permutation_importance)
    correlation_scores = normalize_positive(correlations)

    raw_scores = (
        0.5 * permutation_scores
        + 0.35 * coefficient_importance
        + 0.15 * correlation_scores
    )
    adjusted_scores = raw_scores / np.sqrt(1 + np.array(redundancy))
    normalized_scores = normalize_positive(adjusted_scores)
    if float(normalized_scores.sum()) <= 1e-12:
        normalized_scores = np.ones(feature_count) / feature_count

    feature_rows = []
    for index, feature in enumerate(FEATURES):
        coefficient = float(coefficients[index])
        feature_rows.append({
            "key": feature["key"],
            "label": feature["label"],
            "weight": float(normalized_scores[index] * 100),
            "direction": "positive" if coefficient >= 0 else "negative",
            "coefficient": coefficient,
            "permutation_importance": float(permutation_importance[index]),
            "correlation": float(correlations[index]),
            "redundancy": float(redundancy[index]),
        })

    feature_rows.sort(key=lambda row: row["weight"], reverse=True)
    return {
        "features": feature_rows,
        "model": {
            "algorithm": "标准化日变化 + 岭回归交叉验证 + 置换重要性 + 共线性校正",
            "alpha": alpha,
            "r2_score": max(min(float(r2_score), 1.0), -1.0),
            "baseline_mse": baseline_mse,
        },
        "sample_count": sample_count,
    }, ""


def build_deep_analysis_payload(db, valid_dates, poi_names, product_ids, cache_hit=False):
    records = compute_daily_records(db, valid_dates, product_ids)
    daily_averages = compute_feature_daily_averages(records)
    analysis, message = analyze_feature_weights(records)
    date_range = {
        "start": records[0]["date"] if records else None,
        "end": records[-1]["date"] if records else None,
    }
    scope = {
        "mode": "selected" if poi_names else "all",
        "poi_names": poi_names,
    }
    if analysis is None:
        return {
            "status": "insufficient",
            "message": message,
            "cached": cache_hit,
            "scope": scope,
            "date_count": len(records),
            "sample_count": max(len(records) - 1, 0),
            "date_range": date_range,
            "features": [],
            "model": None,
            "recent_records": records[-12:],
        }

    feature_kinds = {feature["key"]: feature["kind"] for feature in FEATURES}
    for feature in analysis["features"]:
        feature["daily_average"] = daily_averages.get(feature["key"], 0.0)
        feature["value_kind"] = feature_kinds.get(feature["key"], "volume")

    return {
        "status": "ready",
        "message": "模型已基于最新双数据齐全日期实时训练完成。",
        "cached": cache_hit,
        "scope": scope,
        "date_count": len(records),
        "sample_count": analysis["sample_count"],
        "date_range": date_range,
        "features": analysis["features"],
        "model": analysis["model"],
        "recent_records": records[-12:],
    }


@router.get("/deep_analysis")
def get_deep_analysis(poiNames: str = None, db: Session = Depends(get_db)):
    poi_names = parse_poi_names(poiNames)
    product_ids = get_product_ids_for_pois(db, poi_names) if poi_names else None
    valid_dates = get_valid_dual_dates(db)
    cache_key = build_cache_key(valid_dates, poi_names)

    cached_payload = DEEP_ANALYSIS_CACHE.get(cache_key)
    if cached_payload is not None:
        payload = deepcopy(cached_payload)
        payload["cached"] = True
        return payload

    payload = build_deep_analysis_payload(db, valid_dates, poi_names, product_ids, cache_hit=False)
    current_version = cache_key[0]
    current_date_key = cache_key[2]
    for existing_key in list(DEEP_ANALYSIS_CACHE):
        if existing_key[0] != current_version or existing_key[2] != current_date_key:
            del DEEP_ANALYSIS_CACHE[existing_key]
    DEEP_ANALYSIS_CACHE[cache_key] = deepcopy(payload)
    return payload

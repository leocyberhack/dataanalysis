import math
from copy import deepcopy

import numpy as np
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from deps import get_db
from services import get_data_change_version, get_product_ids_for_pois, parse_poi_names, safe_divide

# 新增机器学习与因果推断库
from scipy import stats
from sklearn.linear_model import ElasticNetCV, RidgeCV
from sklearn.ensemble import RandomForestRegressor
import xgboost as xgb
import lightgbm as lgb
import shap

router = APIRouter()
DEEP_ANALYSIS_CACHE = {}

# 整合为 8 大核心特征维度，支持“支付转化率”和“静默支付转化率”并存分析
FEATURES = [
    {"key": "visitor_count", "label": "访客数", "kind": "volume"},
    {"key": "bounce_rate", "label": "详情页跳出率", "kind": "rate"},
    {"key": "pay_conversion", "label": "支付转化率", "kind": "rate"},
    {"key": "silent_pay_conversion", "label": "静默支付转化率", "kind": "rate"},
    {"key": "price_multiplier", "label": "价格倍数", "kind": "rate"},
    {"key": "live_pay_amount", "label": "店播支付金额", "kind": "volume"},
    {"key": "redeem_rate_amount", "label": "核销率(金额)", "kind": "rate"},
    {"key": "refund_rate_amount", "label": "成功退款率(金额)", "kind": "rate"},
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
    pay_users_column = func.coalesce(models.DailyProductSummary.pay_users, 0)
    price_multiplier_column = func.coalesce(models.DailyProductSummary.price_multiplier, 0)
    silent_pay_conversion_column = func.coalesce(models.DailyProductSummary.silent_pay_conversion, 0)

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
        
        # 新增指标的聚合列
        func.sum(pay_users_column).label("pay_users"),
        func.sum(price_multiplier_column * pay_users_column).label("multiplier_weighted_sum"),
        func.sum(pay_users_column).label("multiplier_weight"),
        func.sum(models.DailyProductSummary.live_pay_amount).label("live_pay_amount"),
        
        # 静默支付转化率的加权和 (以访客数为权重)
        func.sum(silent_pay_conversion_column * visitor_count).label("silent_pay_weighted_sum")
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
        visitor_cnt = float(row.visitor_count or 0)
        pay_usr = float(row.pay_users or 0)
        
        records.append({
            "date": row.date.strftime("%Y-%m-%d"),
            "visitor_count": visitor_cnt,
            "bounce_rate": safe_divide(row.bounce_weighted_sum, row.bounce_weight),
            "page_views": float(row.page_views or 0),
            "pay_conversion": safe_divide(pay_usr, visitor_cnt, 100),
            "silent_pay_conversion": safe_divide(row.silent_pay_weighted_sum, row.bounce_weight),
            "price_multiplier": safe_divide(row.multiplier_weighted_sum, row.multiplier_weight),
            "live_pay_amount": float(row.live_pay_amount or 0),
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


def compute_product_daily_records(db, valid_dates, product_ids=None):
    if not valid_dates:
        return []

    query = db.query(
        models.DailyProductSummary.date.label("date"),
        models.DailyProductSummary.product_id.label("product_id"),
        models.DailyProductSummary.visitor_count.label("visitor_count"),
        models.DailyProductSummary.bounce_rate.label("bounce_rate"),
        models.DailyProductSummary.page_views.label("page_views"),
        models.DailyProductSummary.redeem_amount.label("redeem_amount"),
        models.DailyProductSummary.refund_amount.label("refund_amount"),
        models.DailyProductSummary.pay_amount.label("pay_amount"),
        models.DailyProductSummary.profit.label("profit"),
        
        # 细粒度数据列
        models.DailyProductSummary.pay_conversion.label("pay_conversion"),
        models.DailyProductSummary.silent_pay_conversion.label("silent_pay_conversion"),
        models.DailyProductSummary.price_multiplier.label("price_multiplier"),
        models.DailyProductSummary.live_pay_amount.label("live_pay_amount")
    ).filter(
        models.DailyProductSummary.date.in_(valid_dates)
    )

    if product_ids is not None:
        if not product_ids:
            return []
        query = query.filter(models.DailyProductSummary.product_id.in_(product_ids))

    records = []
    for row in query.order_by(models.DailyProductSummary.product_id, models.DailyProductSummary.date.asc()).all():
        pay_amount = float(row.pay_amount or 0)
        records.append({
            "date": row.date.strftime("%Y-%m-%d"),
            "product_id": row.product_id,
            "visitor_count": float(row.visitor_count or 0),
            "bounce_rate": float(row.bounce_rate or 0),
            "page_views": float(row.page_views or 0),
            "pay_conversion": float(row.pay_conversion or 0),
            "silent_pay_conversion": float(row.silent_pay_conversion or 0),
            "price_multiplier": float(row.price_multiplier or 0),
            "live_pay_amount": float(row.live_pay_amount or 0),
            "redeem_rate_amount": safe_divide(row.redeem_amount, pay_amount, 100),
            "refund_rate_amount": safe_divide(row.refund_amount, pay_amount, 100),
            "pay_amount": pay_amount,
            "profit": float(row.profit or 0),
        })
    return records


def build_product_change_matrix(records, valid_dates):
    from collections import defaultdict
    product_records = defaultdict(list)
    for r in records:
        product_records[r["product_id"]].append(r)

    date_indices = {date.strftime("%Y-%m-%d"): i for i, date in enumerate(valid_dates)}

    x_rows = []
    y_values = []

    for product_id, recs in product_records.items():
        recs.sort(key=lambda r: date_indices[r["date"]])
        for idx in range(1, len(recs)):
            curr = recs[idx]
            prev = recs[idx - 1]
            
            curr_date_idx = date_indices[curr["date"]]
            prev_date_idx = date_indices[prev["date"]]
            
            if curr_date_idx - prev_date_idx == 1:
                row_features = [
                    transform_change(curr[feature["key"]], prev[feature["key"]], feature["kind"])
                    for feature in FEATURES
                ]
                x_rows.append(row_features)
                y_values.append(signed_log1p(curr["profit"]) - signed_log1p(prev["profit"]))

    return np.array(x_rows, dtype=float), np.array(y_values, dtype=float)


def compute_dml_causal_effect(X, y, feature_index, linear_mode=False):
    n_samples = X.shape[0]
    if n_samples < 5:
        return 0.0, 1.0, (0.0, 0.0)

    T = X[:, feature_index]
    W = np.delete(X, feature_index, axis=1)

    if linear_mode:
        model_T = RidgeCV(cv=min(3, n_samples))
        model_Y = RidgeCV(cv=min(3, n_samples))
    else:
        model_T = RandomForestRegressor(n_estimators=30, max_depth=3, random_state=42)
        model_Y = RandomForestRegressor(n_estimators=30, max_depth=3, random_state=42)

    try:
        model_T.fit(W, T)
        model_Y.fit(W, y)
        T_pred = model_T.predict(W)
        Y_pred = model_Y.predict(W)
    except Exception:
        T_pred = np.mean(T) * np.ones_like(T)
        Y_pred = np.mean(y) * np.ones_like(y)

    T_res = T - T_pred
    Y_res = y - Y_pred

    denom = float(np.sum(T_res ** 2))
    if denom < 1e-12:
        return 0.0, 1.0, (0.0, 0.0)

    theta = float(np.sum(Y_res * T_res) / denom)

    residuals = Y_res - theta * T_res
    ssr = float(np.sum(residuals ** 2))
    df = n_samples - 1
    if df <= 0:
        return theta, 1.0, (theta, theta)

    s2 = ssr / df
    se = math.sqrt(s2 / denom)

    if se < 1e-12:
        t_stat = 0.0
        p_val = 1.0
    else:
        t_stat = theta / se
        p_val = float(2 * (1 - stats.t.cdf(abs(t_stat), df)))

    try:
        t_critical = stats.t.ppf(0.975, df)
        ci_lower = theta - t_critical * se
        ci_upper = theta + t_critical * se
    except Exception:
        ci_lower = theta
        ci_upper = theta

    return theta, p_val, (ci_lower, ci_upper)


# ==========================================
# 步骤 7: 双重机器学习因果推荐建议逻辑 (含静默支付转化率)
# ==========================================

def generate_causal_recommendation(key, direction, p_value):
    is_significant = p_value < 0.05
    if key == "visitor_count":
        if is_significant and direction == "positive":
            return "访客数是利润增长的核心驱动力。建议加大营销推广力度，引入更多精准的高客单意向流量。"
        elif is_significant:
            return "当前访客增长对利润有反向侵蚀作用，表明新增了大量低转化无效流量，应优化推广结构，提升客流质量。"
        else:
            return "当前样本下增加访客对利润的直接边际拉动尚不显著，建议优先优化详情页转化率，做好‘流量承接’。"
    elif key == "bounce_rate":
        if is_significant and direction == "negative":
            return "详情页跳出率每上升 1% 都会显著吞噬利润！必须重点优化详情页面文案、首图设计和评价区，提高顾客留存。"
        elif is_significant:
            return "跳出率与利润呈正向偏离，说明高利润套餐在带来利润的同时流失率也高，可尝试细化高价商品描述以作缓和。"
        else:
            return "跳出率波动在当前阶段对利润没有显著的直接冲击，维持常规监控即可。"
    elif key == "pay_conversion":
        if is_significant and direction == "positive":
            return "整体支付转化率对利润具有极显著正向拉动，表明大盘销售成交漏斗健康。建议配合活动加强优惠支付引导。"
        else:
            return "支付转化率对利润的直接边际提升尚不显著，建议针对性优化用户流失高的购买环节。"
    elif key == "silent_pay_conversion":
        if is_significant and direction == "positive":
            return "静默支付转化率具有显著正向因果效应！说明免咨询的自助购买流程极其赚钱，建议在详情页直接把客服常被问到的 FAQ 标明，推行‘免催付自助闭环’。"
        elif is_significant:
            return "静默转化率上升反伴随利润下滑，可能是高单价高利润商品必须依赖客服深度建立信任沟通。建议调配客服主动对询单进行干预与转化。"
        else:
            return "静默转化变化在当前幅度下对利润无显著因果拉动。目前自助与询单比例均衡，优化详情页规则清晰度即可。"
    elif key == "price_multiplier":
        if is_significant and direction == "positive":
            return "价格倍数（售价÷参考价）呈现显著正因果！表明该商品溢价力较强，提价能直接带涨利润，可稳步维持溢价策略。"
        elif is_significant:
            return "价格倍数呈现显著的负向因果影响！说明目前售价过高，已严重抑制转化并损害整体毛利，建议适当降价让利以薄利多销。"
        else:
            return "价格倍数变化在当前幅度下对利润无显著影响。目前定价结构相对平稳，可以尝试微调来测试最优利润定价点。"
    elif key == "live_pay_amount":
        if is_significant and direction == "positive":
            return "店播支付金额对利润有极显著的因果拉动。直播带货渠道效果优异，应继续丰富直播间货盘并加大直播引流倾斜。"
        elif is_significant:
            return "店播支付量增多却引起利润倒退！这通常是因为店播折扣过大或坑位费/扣点成本过高，应严格控制直播定价及佣金成本。"
        else:
            return "店播在统计上对利润的边际影响尚未达到显著水平，建议精细化分析单次直播的投入产出比（ROI）。"
    elif key == "redeem_rate_amount":
        if is_significant and direction == "positive":
            return "核销率（金额）对利润有极显著的因果拉动！说明订单真正到店消费是实现盈利的闭环，建议主动推送消费券提醒。"
        elif is_significant:
            return "核销率增高伴随利润下降，这常见于过度打折让利。建议核算团购券和直播单的折扣点，避免亏损运营。"
        else:
            return "核销率变动在统计上对利润边际影响暂不显著，保持常规核销引导与跟进。"
    elif key == "refund_rate_amount":
        if is_significant and direction == "negative":
            return "成功退款率对利润具有极强的侵蚀作用！必须立即排查退款原因（服务差/描述不符/货不对板），降低售后流失。"
        else:
            return "当前退款率变化对整体利润的冲击未达到统计显著水平，但仍建议监控，使其保持在合理低位。"
    return "维持指标在稳定范围，继续累积样本观察。"


def analyze_feature_weights_product_level(db, valid_dates, product_ids=None):
    product_records = compute_product_daily_records(db, valid_dates, product_ids)
    x_raw, y_raw = build_product_change_matrix(product_records, valid_dates)
    sample_count = x_raw.shape[0]
    feature_count = len(FEATURES)

    if sample_count < 4:
        return None, f"商品级有效变化样本数过少（仅有 {sample_count} 个），至少需要 4 个样本才能建立分析模型，请多上传几天的商品和订单数据。"

    if float(np.std(y_raw)) <= 1e-12:
        return None, "商品利润变化过小，暂时无法建立影响权重关系。"

    x_mean = x_raw.mean(axis=0)
    x_std = x_raw.std(axis=0)
    y_mean = y_raw.mean()
    y_std = y_raw.std()

    active_mask = x_std > 1e-12

    x_values = np.zeros_like(x_raw)
    x_values[:, active_mask] = (x_raw[:, active_mask] - x_mean[active_mask]) / x_std[active_mask]
    y_values = (y_raw - y_mean) / (y_std if y_std > 1e-12 else 1.0)

    algorithm_name = ""
    r2_score = 0.0
    baseline_mse = 0.0

    coefficients = np.zeros(feature_count)
    shap_importance = np.zeros(feature_count)
    causal_effects = []

    # 1. 拟合与解释
    if sample_count >= 15:
        algorithm_name = "商品级细粒度 + 集成树模型(LightGBM+XGBoost+ElasticNet) + SHAP博弈权重 + 双重机器学习因果去偏"

        # Fit models
        try:
            linear = ElasticNetCV(cv=min(5, sample_count), random_state=42)
            linear.fit(x_values, y_values)
            coef_raw = linear.coef_
        except Exception:
            linear = RidgeCV(cv=min(5, sample_count))
            linear.fit(x_values, y_values)
            coef_raw = linear.coef_

        coefficients = coef_raw

        # LightGBM
        lgb_model = lgb.LGBMRegressor(n_estimators=30, max_depth=3, learning_rate=0.1, random_state=42, verbose=-1)
        lgb_model.fit(x_values, y_values)

        # XGBoost
        xgb_model = xgb.XGBRegressor(n_estimators=30, max_depth=3, learning_rate=0.1, random_state=42, verbosity=0)
        xgb_model.fit(x_values, y_values)

        # We assign weights to each model
        w_linear, w_lgb, w_xgb = 0.3, 0.35, 0.35

        # Compute SHAP
        try:
            # Linear Explainer
            explainer_linear = shap.LinearExplainer(linear, x_values)
            shap_linear = np.array(explainer_linear.shap_values(x_values))

            # Tree Explainers
            explainer_lgb = shap.TreeExplainer(lgb_model)
            shap_lgb = np.array(explainer_lgb.shap_values(x_values))
            if len(shap_lgb.shape) == 3 and shap_lgb.shape[2] == 2:
                shap_lgb = shap_lgb[:, :, 1]

            explainer_xgb = shap.TreeExplainer(xgb_model)
            shap_xgb = np.array(explainer_xgb.shap_values(x_values))

            # Ensemble SHAP
            shap_ensemble = w_linear * shap_linear + w_lgb * shap_lgb + w_xgb * shap_xgb
            shap_importance = np.mean(np.abs(shap_ensemble), axis=0)
        except Exception as e:
            print(f"SHAP estimation failed: {e}. Fallback to linear regression coefficients.")
            shap_importance = np.abs(coefficients)

        # Predictions & R2
        y_pred = w_linear * linear.predict(x_values) + w_lgb * lgb_model.predict(x_values) + w_xgb * xgb_model.predict(x_values)
        residuals = y_values - y_pred
        baseline_mse = float(np.mean(residuals ** 2))
        total_variance = float(np.sum((y_values - y_values.mean()) ** 2))
        r2_score = 1 - float(np.sum(residuals ** 2)) / total_variance if total_variance > 1e-12 else 0.0

        # Causal inference (DML)
        for index in range(feature_count):
            if not active_mask[index]:
                causal_effects.append({"theta": 0.0, "p_value": 1.0, "ci": (0.0, 0.0)})
                continue
            theta, p_val, ci = compute_dml_causal_effect(x_values, y_values, index, linear_mode=False)
            causal_effects.append({"theta": theta, "p_value": p_val, "ci": ci})

    else:
        algorithm_name = "商品级细粒度 + 稳健ElasticNet线性模型校准 + SHAP博弈权重 (小样本量自动退避逻辑)"

        try:
            linear = ElasticNetCV(cv=min(3, sample_count), random_state=42)
            linear.fit(x_values, y_values)
        except Exception:
            linear = RidgeCV(cv=min(3, sample_count))
            linear.fit(x_values, y_values)

        coefficients = linear.coef_

        try:
            explainer_linear = shap.LinearExplainer(linear, x_values)
            shap_linear = np.array(explainer_linear.shap_values(x_values))
            shap_importance = np.mean(np.abs(shap_linear), axis=0)
        except Exception:
            shap_importance = np.abs(coefficients)

        y_pred = linear.predict(x_values)
        residuals = y_values - y_pred
        baseline_mse = float(np.mean(residuals ** 2))
        total_variance = float(np.sum((y_values - y_values.mean()) ** 2))
        r2_score = 1 - float(np.sum(residuals ** 2)) / total_variance if total_variance > 1e-12 else 0.0

        # Causal inference using linear DML
        for index in range(feature_count):
            if not active_mask[index]:
                causal_effects.append({"theta": 0.0, "p_value": 1.0, "ci": (0.0, 0.0)})
                continue
            theta, p_val, ci = compute_dml_causal_effect(x_values, y_values, index, linear_mode=True)
            causal_effects.append({"theta": theta, "p_value": p_val, "ci": ci})

    # Normalized SHAP weights
    normalized_weights = normalize_positive(shap_importance)
    if float(normalized_weights.sum()) <= 1e-12:
        normalized_weights = np.ones(feature_count) / feature_count

    feature_rows = []
    for index, feature in enumerate(FEATURES):
        coef = float(coefficients[index])
        dml_info = causal_effects[index]
        theta = dml_info["theta"]
        p_val = dml_info["p_value"]
        ci = dml_info["ci"]

        if active_mask[index]:
            try:
                correlation = float(np.corrcoef(x_values[:, index], y_values)[0, 1])
                if not np.isfinite(correlation):
                    correlation = 0.0
            except Exception:
                correlation = 0.0
        else:
            correlation = 0.0

        direction = "positive" if theta >= 0 else "negative"
        recommendation = generate_causal_recommendation(feature["key"], direction, p_val)

        feature_rows.append({
            "key": feature["key"],
            "label": feature["label"],
            "weight": float(normalized_weights[index] * 100),
            "direction": direction,
            "coefficient": coef,
            "correlation": correlation,
            "causal_effect": theta,
            "p_value": p_val,
            "ci_lower": ci[0],
            "ci_upper": ci[1],
            "recommendation": recommendation
        })

    feature_rows.sort(key=lambda row: row["weight"], reverse=True)

    return {
        "features": feature_rows,
        "model": {
            "algorithm": algorithm_name,
            "r2_score": max(min(float(r2_score), 1.0), -1.0),
            "baseline_mse": baseline_mse,
        },
        "sample_count": sample_count,
    }, ""


def build_deep_analysis_payload(db, valid_dates, poi_names, product_ids, cache_hit=False):
    records = compute_daily_records(db, valid_dates, product_ids)
    daily_averages = compute_feature_daily_averages(records)
    analysis, message = analyze_feature_weights_product_level(db, valid_dates, product_ids)
    
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
        "message": "模型已基于最新双数据齐全日期，以单个商品单日变化为样本，由集成算法和因果估计器实时训练完成。",
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

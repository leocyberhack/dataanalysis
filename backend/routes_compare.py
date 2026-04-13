from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from deps import get_db
from services import (
    COMPARE_TOTAL_DEPENDENCIES,
    NON_ADDITIVE_AVERAGE_FIELDS,
    apply_product_filter,
    compute_display_metric_value,
    parse_compare_metrics,
    parse_product_ids,
)


router = APIRouter()


@router.get("/compare/aggregate")
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


@router.get("/compare/trend")
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

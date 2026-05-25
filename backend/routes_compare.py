from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from deps import get_db
from services import (
    build_compare_aggregate_payload,
    build_compare_report_payload,
    build_compare_trend_payload,
    build_compare_trends_payload,
    get_cached_response,
    parse_compare_metrics,
    parse_poi_names,
    parse_product_ids,
)


router = APIRouter()


@router.get("/compare/aggregate")
def get_compare_aggregate(
    startDate: str,
    endDate: str,
    groupBy: str = "product",
    productIds: str = None,
    poiNames: str = None,
    metrics: str = None,
    db: Session = Depends(get_db),
):
    try:
        start = datetime.strptime(startDate, "%Y-%m-%d").date()
        end = datetime.strptime(endDate, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid dates")

    selected_metrics = parse_compare_metrics(metrics)
    parsed_product_ids = parse_product_ids(productIds)
    parsed_poi_names = parse_poi_names(poiNames)
    return get_cached_response(
        "compare_aggregate",
        (start, end, groupBy, tuple(parsed_product_ids), tuple(parsed_poi_names), tuple(selected_metrics)),
        lambda: build_compare_aggregate_payload(
            db=db,
            start_date=start,
            end_date=end,
            selected_metrics=selected_metrics,
            group_by=groupBy,
            product_ids=parsed_product_ids,
            poi_names=parsed_poi_names,
        ),
    )


@router.get("/compare/report")
def get_compare_report(
    startDate: str,
    endDate: str,
    groupBy: str = "product",
    productIds: str = None,
    poiNames: str = None,
    metrics: str = None,
    trendMetric: str = None,
    trendLimit: int = 5,
    db: Session = Depends(get_db),
):
    try:
        start = datetime.strptime(startDate, "%Y-%m-%d").date()
        end = datetime.strptime(endDate, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid dates")

    selected_metrics = parse_compare_metrics(metrics)
    parsed_trend_metric = parse_compare_metrics(trendMetric)[0] if trendMetric else None
    parsed_product_ids = parse_product_ids(productIds)
    parsed_poi_names = parse_poi_names(poiNames)
    return get_cached_response(
        "compare_report",
        (
            start,
            end,
            groupBy,
            tuple(parsed_product_ids),
            tuple(parsed_poi_names),
            tuple(selected_metrics),
            parsed_trend_metric,
            trendLimit,
        ),
        lambda: build_compare_report_payload(
            db=db,
            start_date=start,
            end_date=end,
            selected_metrics=selected_metrics,
            group_by=groupBy,
            product_ids=parsed_product_ids,
            poi_names=parsed_poi_names,
            trend_metric=parsed_trend_metric,
            trend_limit=trendLimit,
        ),
    )


@router.get("/compare/trend")
def get_compare_trend(
    startDate: str,
    endDate: str,
    metric: str,
    groupBy: str = "product",
    productIds: str = None,
    poiNames: str = None,
    axisProductIds: str = None,
    axisPoiNames: str = None,
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
    trend_poi_names = parse_poi_names(poiNames)

    if groupBy == "product" and parse_poi_names(axisPoiNames):
        raise HTTPException(status_code=400, detail="Product compare mode does not accept POI axis filters")
    if groupBy == "poi" and parse_product_ids(axisProductIds):
        raise HTTPException(status_code=400, detail="POI compare mode does not accept product axis filters")

    payload = get_cached_response(
        "compare_trend",
        (start, end, groupBy, tuple(trend_product_ids), tuple(trend_poi_names), selected_metric),
        lambda: build_compare_trend_payload(
            db=db,
            start_date=start,
            end_date=end,
            metric=selected_metric,
            group_by=groupBy,
            product_ids=trend_product_ids,
            poi_names=trend_poi_names,
        ),
    )

    if includeDates:
        return payload

    return payload["rows"]


@router.get("/poi/insight")
def get_poi_insight(
    startDate: str,
    endDate: str,
    previousStartDate: str,
    previousEndDate: str,
    metrics: str,
    trendLimit: int = 5,
    db: Session = Depends(get_db),
):
    try:
        start = datetime.strptime(startDate, "%Y-%m-%d").date()
        end = datetime.strptime(endDate, "%Y-%m-%d").date()
        previous_start = datetime.strptime(previousStartDate, "%Y-%m-%d").date()
        previous_end = datetime.strptime(previousEndDate, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid dates")

    selected_metrics = parse_compare_metrics(metrics)
    def build_payload():
        current_aggregate = build_compare_aggregate_payload(
            db=db,
            start_date=start,
            end_date=end,
            selected_metrics=selected_metrics,
            group_by="poi",
        )
        previous_aggregate = build_compare_aggregate_payload(
            db=db,
            start_date=previous_start,
            end_date=previous_end,
            selected_metrics=selected_metrics,
            group_by="poi",
        )

        current_rows = current_aggregate.get("rows") or []
        trend_group_keys = {}
        trend_group_names = {}
        safe_trend_limit = max(1, min(int(trendLimit or 5), 20))
        for metric in selected_metrics:
            top_rows = sorted(
                current_rows,
                key=lambda row: float(row.get(f"{metric}_total") or 0),
                reverse=True,
            )[:safe_trend_limit]
            trend_group_keys[metric] = [row["group_key"] for row in top_rows]
            trend_group_names[metric] = {
                row["group_key"]: row["group_name"]
                for row in top_rows
            }

        trend_payloads = build_compare_trends_payload(
            db=db,
            start_date=start,
            end_date=end,
            selected_metrics=selected_metrics,
            group_by="poi",
            group_keys_by_metric=trend_group_keys,
        )

        return {
            "current": current_aggregate,
            "previous": previous_aggregate,
            "trends": {
                metric: {
                    **trend_payloads.get(metric, {"dates": [], "rows": [], "group_by": "poi"}),
                    "group_names": trend_group_names.get(metric, {}),
                }
                for metric in selected_metrics
            },
        }

    return get_cached_response(
        "poi_insight",
        (start, end, previous_start, previous_end, tuple(selected_metrics), trendLimit),
        build_payload,
    )

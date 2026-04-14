from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from deps import get_db
from services import (
    build_compare_aggregate_payload,
    build_compare_trend_payload,
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
    return build_compare_aggregate_payload(
        db=db,
        start_date=start,
        end_date=end,
        selected_metrics=selected_metrics,
        group_by=groupBy,
        product_ids=parse_product_ids(productIds),
        poi_names=parse_poi_names(poiNames),
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

    payload = build_compare_trend_payload(
        db=db,
        start_date=start,
        end_date=end,
        metric=selected_metric,
        group_by=groupBy,
        product_ids=trend_product_ids,
        poi_names=trend_poi_names,
    )

    if includeDates:
        return payload

    return payload["rows"]

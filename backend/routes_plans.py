import calendar
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from deps import get_db
from schemas import PlanCreateRequest
from services import build_compare_aggregate_payload, parse_compare_metrics


router = APIRouter()

MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}$")


def parse_months(months):
    parsed_months = []
    seen_months = set()
    for raw_month in months or []:
        month = str(raw_month).strip()
        if not MONTH_PATTERN.match(month):
            raise HTTPException(status_code=400, detail=f"Invalid month: {month}")
        year, month_number = month.split("-")
        month_index = int(month_number)
        if month_index < 1 or month_index > 12:
            raise HTTPException(status_code=400, detail=f"Invalid month: {month}")
        if month not in seen_months:
            parsed_months.append(month)
            seen_months.add(month)
    if not parsed_months:
        raise HTTPException(status_code=400, detail="At least one month is required")
    return sorted(parsed_months)


def get_month_range(month):
    year_text, month_text = month.split("-")
    year = int(year_text)
    month_number = int(month_text)
    last_day = calendar.monthrange(year, month_number)[1]
    return date(year, month_number, 1), date(year, month_number, last_day)


def split_stored_list(value):
    if not value:
        return []
    return [item for item in value.split(",") if item]


def serialize_plan(plan, db):
    months = split_stored_list(plan.months)
    poi_names = split_stored_list(plan.poi_names)
    target_value = float(plan.target_value or 0)
    progress = []

    for month in months:
        start_date, end_date = get_month_range(month)
        aggregate = build_compare_aggregate_payload(
            db=db,
            start_date=start_date,
            end_date=end_date,
            selected_metrics=[plan.metric],
            group_by="poi",
            poi_names=poi_names if plan.poi_mode == "selected" else None,
        )
        actual_value = float(aggregate["overall_totals"].get(plan.metric) or 0)
        percentage = (actual_value / target_value * 100) if target_value > 0 else 0
        progress.append({
            "month": month,
            "actual_value": actual_value,
            "target_value": target_value,
            "percentage": percentage,
            "achieved": target_value > 0 and actual_value >= target_value,
        })

    return {
        "id": plan.id,
        "name": plan.name or "",
        "metric": plan.metric,
        "target_value": target_value,
        "poi_mode": plan.poi_mode,
        "poi_names": poi_names,
        "months": months,
        "progress": progress,
    }


@router.get("/plans")
def get_plans(db: Session = Depends(get_db)):
    plans = db.query(models.Plan).order_by(models.Plan.id.desc()).all()
    return [serialize_plan(plan, db) for plan in plans]


@router.post("/plans")
def create_plan(request: PlanCreateRequest, db: Session = Depends(get_db)):
    selected_metric = parse_compare_metrics(request.metric)[0]
    months = parse_months(request.months)
    poi_mode = "selected" if request.poi_mode == "selected" else "all"
    poi_names = []

    if poi_mode == "selected":
        poi_names = list(dict.fromkeys(
            str(name).strip()
            for name in request.poi_names
            if str(name).strip()
        ))
        if not poi_names:
            raise HTTPException(status_code=400, detail="At least one POI is required")

    if request.target_value <= 0:
        raise HTTPException(status_code=400, detail="Target value must be greater than 0")

    plan = models.Plan(
        name=(request.name or "").strip(),
        metric=selected_metric,
        target_value=request.target_value,
        poi_mode=poi_mode,
        poi_names=",".join(poi_names),
        months=",".join(months),
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return serialize_plan(plan, db)


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = db.query(models.Plan).filter(models.Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    db.delete(plan)
    db.commit()
    return {"message": "Plan deleted"}

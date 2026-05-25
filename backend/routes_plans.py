import calendar
import json
import re
from collections import defaultdict
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from deps import get_db
from schemas import PlanCreateRequest
from services import (
    clear_runtime_caches,
    compute_compare_overall_metric,
    compute_compare_overall_metrics_by_month,
    get_cached_response,
    parse_compare_metrics,
)


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


def parse_month_targets(months, month_targets, fallback_target=None):
    normalized_targets = {}
    for month in months:
        target_value = month_targets.get(month) if month_targets else None
        if target_value is None:
            target_value = fallback_target
        try:
            numeric_target = float(target_value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail=f"Invalid target value for {month}")
        if numeric_target <= 0:
            raise HTTPException(status_code=400, detail=f"Target value for {month} must be greater than 0")
        normalized_targets[month] = numeric_target
    return normalized_targets


def load_plan_month_targets(plan, months):
    try:
        raw_targets = json.loads(plan.month_targets or "{}")
    except json.JSONDecodeError:
        raw_targets = {}

    fallback_target = float(plan.target_value or 0)
    return {
        month: float(raw_targets.get(month, fallback_target) or 0)
        for month in months
    }


def serialize_plan(plan, db, actual_values_by_month=None):
    months = split_stored_list(plan.months)
    poi_names = split_stored_list(plan.poi_names)
    month_targets = load_plan_month_targets(plan, months)
    progress = []

    for month in months:
        target_value = month_targets.get(month, 0)
        if actual_values_by_month is None:
            start_date, end_date = get_month_range(month)
            actual_value = compute_compare_overall_metric(
                db=db,
                start_date=start_date,
                end_date=end_date,
                metric=plan.metric,
                poi_names=poi_names if plan.poi_mode == "selected" else None,
                poi_scope=plan.poi_mode == "selected",
            )
        else:
            actual_value = actual_values_by_month.get(month, 0)
        actual_value = float(actual_value or 0)
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
        "target_value": next(iter(month_targets.values()), float(plan.target_value or 0)),
        "month_targets": month_targets,
        "poi_mode": plan.poi_mode,
        "poi_names": poi_names,
        "months": months,
        "progress": progress,
    }


def get_plan_scope_key(plan):
    poi_names = split_stored_list(plan.poi_names)
    if plan.poi_mode == "selected":
        return "selected", tuple(poi_names)
    return "all", ()


def get_plan_months(plan):
    return split_stored_list(plan.months)


def serialize_plans_with_batch_progress(plans, db):
    grouped_months = defaultdict(set)
    for plan in plans:
        scope_key = get_plan_scope_key(plan)
        grouped_months[(plan.metric, scope_key)].update(get_plan_months(plan))

    actual_values = {}
    for (metric, scope_key), months in grouped_months.items():
        scope_mode, scope_pois = scope_key
        month_values = compute_compare_overall_metrics_by_month(
            db=db,
            months=sorted(months),
            metric=metric,
            poi_names=list(scope_pois) if scope_mode == "selected" else None,
            poi_scope=scope_mode == "selected",
        )
        for month, value in month_values.items():
            actual_values[(metric, scope_key, month)] = value

    serialized = []
    for plan in plans:
        scope_key = get_plan_scope_key(plan)
        plan_values = {
            month: actual_values.get((plan.metric, scope_key, month), 0)
            for month in get_plan_months(plan)
        }
        serialized.append(serialize_plan(plan, db, actual_values_by_month=plan_values))
    return serialized


@router.get("/plans")
def get_plans(db: Session = Depends(get_db)):
    plans = db.query(models.Plan).order_by(models.Plan.id.desc()).all()
    cache_key = tuple(
        (
            plan.id,
            plan.metric,
            plan.target_value,
            plan.month_targets,
            plan.poi_mode,
            plan.poi_names,
            plan.months,
        )
        for plan in plans
    )
    return get_cached_response(
        "plans",
        cache_key,
        lambda: serialize_plans_with_batch_progress(plans, db),
    )


@router.post("/plans")
def create_plan(request: PlanCreateRequest, db: Session = Depends(get_db)):
    selected_metric = parse_compare_metrics(request.metric)[0]
    months = parse_months(request.months)
    month_targets = parse_month_targets(months, request.month_targets, request.target_value)
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

    plan = models.Plan(
        name=(request.name or "").strip(),
        metric=selected_metric,
        target_value=next(iter(month_targets.values()), 0),
        month_targets=json.dumps(month_targets, ensure_ascii=False),
        poi_mode=poi_mode,
        poi_names=",".join(poi_names),
        months=",".join(months),
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    clear_runtime_caches()
    return serialize_plan(plan, db)


@router.put("/plans/{plan_id}")
def update_plan(plan_id: int, request: PlanCreateRequest, db: Session = Depends(get_db)):
    plan = db.query(models.Plan).filter(models.Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    selected_metric = parse_compare_metrics(request.metric)[0]
    months = parse_months(request.months)
    month_targets = parse_month_targets(months, request.month_targets, request.target_value)
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

    plan.name = (request.name or "").strip()
    plan.metric = selected_metric
    plan.target_value = next(iter(month_targets.values()), 0)
    plan.month_targets = json.dumps(month_targets, ensure_ascii=False)
    plan.poi_mode = poi_mode
    plan.poi_names = ",".join(poi_names)
    plan.months = ",".join(months)
    db.commit()
    db.refresh(plan)
    clear_runtime_caches()
    return serialize_plan(plan, db)


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: int, db: Session = Depends(get_db)):
    plan = db.query(models.Plan).filter(models.Plan.id == plan_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    db.delete(plan)
    db.commit()
    clear_runtime_caches()
    return {"message": "Plan deleted"}

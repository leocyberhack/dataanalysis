from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from deps import get_db
from services import (
    PRODUCT_INDEX,
    apply_product_filter,
    compute_total_rate,
    get_pois,
    get_product_ids_for_pois,
    parse_poi_names,
    parse_product_ids,
)


router = APIRouter()


@router.get("/dates")
def get_dates(db: Session = Depends(get_db)):
    dates = db.query(models.DailySummary.date).order_by(models.DailySummary.date.desc()).all()
    return {"dates": [d[0].strftime("%Y-%m-%d") for d in dates]}


@router.get("/date_status")
def get_date_status(db: Session = Depends(get_db)):
    results = db.query(models.DailySummary).order_by(models.DailySummary.date.desc()).all()
    return {
        row.date.strftime("%Y-%m-%d"): {
            "commodity": bool(row.commodity_uploaded),
            "order": bool(row.order_uploaded),
        }
        for row in results
    }


@router.get("/products")
def get_products(startDate: str = None, endDate: str = None, db: Session = Depends(get_db)):
    if startDate and endDate:
        try:
            start = datetime.strptime(startDate, "%Y-%m-%d").date()
            end = datetime.strptime(endDate, "%Y-%m-%d").date()
            return PRODUCT_INDEX.get_products(db, start, end)
        except ValueError:
            pass
    return PRODUCT_INDEX.get_products(db)


@router.get("/pois")
def get_poi_options(startDate: str = None, endDate: str = None, db: Session = Depends(get_db)):
    if startDate and endDate:
        try:
            start = datetime.strptime(startDate, "%Y-%m-%d").date()
            end = datetime.strptime(endDate, "%Y-%m-%d").date()
            return get_pois(db, start, end)
        except ValueError:
            pass
    return get_pois(db)


@router.get("/summary")
def get_summary(
    date: str = None,
    startDate: str = None,
    endDate: str = None,
    productIds: str = None,
    poiNames: str = None,
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
    parsed_poi_names = parse_poi_names(poiNames)
    if parsed_product_ids and parsed_poi_names:
        raise HTTPException(status_code=400, detail="Product and POI filters cannot be combined")

    if parsed_poi_names:
        parsed_product_ids = get_product_ids_for_pois(db, parsed_poi_names)
        if not parsed_product_ids:
            return {"today": None, "yesterday": None, "has_yesterday": False}
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
        "has_yesterday": bool(calc_yesterday),
    }


@router.get("/data")
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

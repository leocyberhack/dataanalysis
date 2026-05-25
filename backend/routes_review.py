from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from deps import get_db
from schemas import ApproveOrderRequest, UpdateProfitRequest
from services import (
    build_order_product_id,
    clear_runtime_caches,
    refresh_materialized_summaries,
    refresh_product_poi_mappings,
)


router = APIRouter()


@router.get("/pending_orders")
def get_pending_orders(db: Session = Depends(get_db)):
    orders = db.query(
        models.PendingOrder.id,
        models.PendingOrder.date,
        models.PendingOrder.order_number,
        models.PendingOrder.order_id,
        models.PendingOrder.product_name,
        models.PendingOrder.specification,
        models.PendingOrder.quantity,
        models.PendingOrder.unit_price,
        models.PendingOrder.total_amount,
        models.PendingOrder.commission,
        models.PendingOrder.profit,
        models.PendingOrder.salesperson,
        models.PendingOrder.status,
    ).filter(
        models.PendingOrder.status == "pending"
    ).order_by(models.PendingOrder.date.desc(), models.PendingOrder.id.desc()).all()

    return [{
        "id": order_id,
        "date": order_date.strftime("%Y-%m-%d"),
        "order_number": order_number,
        "order_id": external_order_id,
        "product_name": product_name,
        "specification": specification,
        "quantity": quantity,
        "unit_price": unit_price,
        "total_amount": total_amount,
        "commission": commission,
        "profit": profit,
        "salesperson": salesperson or "",
        "status": status,
    } for (
        order_id,
        order_date,
        order_number,
        external_order_id,
        product_name,
        specification,
        quantity,
        unit_price,
        total_amount,
        commission,
        profit,
        salesperson,
        status,
    ) in orders]


@router.post("/approve_order/{order_id}")
def approve_order(
    order_id: int,
    req: Optional[ApproveOrderRequest] = Body(default=None),
    db: Session = Depends(get_db),
):
    """Approve a pending order and move its profit into DailyData."""
    order = db.query(models.PendingOrder).filter(models.PendingOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail="Order already processed")

    try:
        if req and req.profit is not None:
            order.profit = req.profit

        product = db.query(models.Product).filter(models.Product.name == order.product_name).first()
        if not product:
            product = models.Product(id=build_order_product_id(order.product_name), name=order.product_name)
            db.add(product)
            db.flush()
        refresh_product_poi_mappings(db, [{"id": product.id, "name": product.name}])

        daily_data = db.query(models.DailyData).filter_by(
            product_id=product.id, date=order.date
        ).first()
        if daily_data:
            daily_data.profit = (daily_data.profit or 0) + order.profit
        else:
            db.add(models.DailyData(
                product_id=product.id,
                date=order.date,
                profit=order.profit
            ))

        order.status = "approved"
        refresh_materialized_summaries(db, order.date)
        db.commit()
        clear_runtime_caches()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to approve order: {exc}") from exc

    return {"message": f"订单已审核通过，利润 {order.profit} 已录入分析数据"}


@router.put("/pending_order/{order_id}")
def update_pending_order(order_id: int, req: UpdateProfitRequest, db: Session = Depends(get_db)):
    """Update the profit of a pending order before approving."""
    order = db.query(models.PendingOrder).filter(models.PendingOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "pending":
        raise HTTPException(status_code=400, detail="Order already processed")

    order.profit = req.profit
    db.commit()
    return {"message": f"利润已更新为 {req.profit}"}


@router.delete("/pending_order/{order_id}")
def delete_pending_order(order_id: int, db: Session = Depends(get_db)):
    """Permanently discard a pending order."""
    order = db.query(models.PendingOrder).filter(models.PendingOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    db.delete(order)
    db.commit()
    return {"message": "订单已删除"}

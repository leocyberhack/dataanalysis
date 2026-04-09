from sqlalchemy import Boolean, Column, Date, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(String, primary_key=True, index=True)
    name = Column(String, index=True)


class DailyData(Base):
    __tablename__ = "daily_data"
    __table_args__ = (
        Index("ix_daily_data_product_id_date", "product_id", "date"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    product_id = Column(String, ForeignKey("products.id"), index=True)
    date = Column(Date, index=True)

    visitor_count = Column(Float, default=0)
    bounce_rate = Column(Float, default=0)
    page_views = Column(Float, default=0)
    avg_visitor_value = Column(Float, default=0)

    order_users = Column(Float, default=0)
    order_amount = Column(Float, default=0)
    order_conversion = Column(Float, default=0)
    order_user_pay_rate = Column(Float, default=0)
    silent_pay_conversion = Column(Float, default=0)

    pay_users = Column(Float, default=0)
    pay_orders = Column(Float, default=0)
    pay_items = Column(Float, default=0)
    pay_amount = Column(Float, default=0)
    pay_conversion = Column(Float, default=0)

    refund_items = Column(Float, default=0)
    refund_amount = Column(Float, default=0)
    refund_rate_item = Column(Float, default=0)
    refund_rate_amount = Column(Float, default=0)
    redeem_items = Column(Float, default=0)
    redeem_amount = Column(Float, default=0)
    redeem_rate_item = Column(Float, default=0)
    redeem_rate_amount = Column(Float, default=0)

    live_pay_amount = Column(Float, default=0)
    live_pay_orders = Column(Float, default=0)
    live_pay_users = Column(Float, default=0)
    live_pay_coupons = Column(Float, default=0)
    live_consume_amount = Column(Float, default=0)
    live_consume_coupons = Column(Float, default=0)
    live_consume_orders = Column(Float, default=0)
    live_refund_amount = Column(Float, default=0)
    live_consume_rate = Column(Float, default=0)
    live_refund_rate = Column(Float, default=0)

    price_multiplier = Column(Float, default=0)
    profit = Column(Float, default=0)

    product = relationship("Product", backref="daily_data")


class PendingOrder(Base):
    __tablename__ = "pending_orders"
    __table_args__ = (
        Index("ix_pending_orders_status_date_id", "status", "date", "id"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    date = Column(Date, index=True)
    order_number = Column(String, default="")
    order_id = Column(String, default="")
    product_name = Column(String, default="")
    specification = Column(String, default="")
    quantity = Column(Float, default=0)
    unit_price = Column(Float, default=0)
    total_amount = Column(Float, default=0)
    commission = Column(Float, default=0)
    profit = Column(Float, default=0)
    salesperson = Column(String, default="")
    status = Column(String, default="pending")


class DailySummary(Base):
    __tablename__ = "daily_summaries"

    date = Column(Date, primary_key=True, index=True)
    pay_amount = Column(Float, default=0)
    pay_orders = Column(Float, default=0)
    pay_items = Column(Float, default=0)
    redeem_items = Column(Float, default=0)
    redeem_amount = Column(Float, default=0)
    refund_amount = Column(Float, default=0)
    refund_items = Column(Float, default=0)
    live_refund_amount = Column(Float, default=0)
    live_consume_amount = Column(Float, default=0)
    profit = Column(Float, default=0)
    commodity_uploaded = Column(Boolean, default=False)
    order_uploaded = Column(Boolean, default=False)


class DailyProductSummary(Base):
    __tablename__ = "daily_product_summaries"
    __table_args__ = (
        Index("ix_daily_product_summaries_date_product_id", "date", "product_id"),
        Index("ix_daily_product_summaries_product_id_date", "product_id", "date"),
    )

    date = Column(Date, primary_key=True, index=True)
    product_id = Column(String, primary_key=True, index=True)
    product_name = Column(String, index=True)

    visitor_count = Column(Float, default=0)
    bounce_rate = Column(Float, default=0)
    page_views = Column(Float, default=0)
    avg_visitor_value = Column(Float, default=0)

    order_users = Column(Float, default=0)
    order_amount = Column(Float, default=0)
    order_conversion = Column(Float, default=0)
    order_user_pay_rate = Column(Float, default=0)
    silent_pay_conversion = Column(Float, default=0)

    pay_users = Column(Float, default=0)
    pay_orders = Column(Float, default=0)
    pay_items = Column(Float, default=0)
    pay_amount = Column(Float, default=0)
    pay_conversion = Column(Float, default=0)

    refund_items = Column(Float, default=0)
    refund_amount = Column(Float, default=0)
    refund_rate_item = Column(Float, default=0)
    refund_rate_amount = Column(Float, default=0)
    redeem_items = Column(Float, default=0)
    redeem_amount = Column(Float, default=0)
    redeem_rate_item = Column(Float, default=0)
    redeem_rate_amount = Column(Float, default=0)

    live_pay_amount = Column(Float, default=0)
    live_pay_orders = Column(Float, default=0)
    live_pay_users = Column(Float, default=0)
    live_pay_coupons = Column(Float, default=0)
    live_consume_amount = Column(Float, default=0)
    live_consume_coupons = Column(Float, default=0)
    live_consume_orders = Column(Float, default=0)
    live_refund_amount = Column(Float, default=0)
    live_consume_rate = Column(Float, default=0)
    live_refund_rate = Column(Float, default=0)

    price_multiplier = Column(Float, default=0)
    profit = Column(Float, default=0)

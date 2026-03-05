from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey
from database import Base
from sqlalchemy.orm import relationship

class Product(Base):
    __tablename__ = "products"
    
    id = Column(String, primary_key=True, index=True)
    name = Column(String)

class DailyData(Base):
    __tablename__ = "daily_data"
    
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

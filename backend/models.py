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


class PendingOrder(Base):
    __tablename__ = "pending_orders"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    date = Column(Date, index=True)
    # We store every original column from the order Excel row
    order_number = Column(String, default="")          # 订单序号
    order_id = Column(String, default="")              # 订单号
    product_name = Column(String, default="")          # 旅游线路
    specification = Column(String, default="")         # 规格
    quantity = Column(Float, default=0)                # 数量
    unit_price = Column(Float, default=0)              # 单价
    total_amount = Column(Float, default=0)            # 总额
    commission = Column(Float, default=0)              # 佣金
    profit = Column(Float, default=0)                  # 利润（原始值，可修改）
    salesperson = Column(String, default="")            # 销售
    status = Column(String, default="pending")         # pending / approved

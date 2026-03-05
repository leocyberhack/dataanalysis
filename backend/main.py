import io
import pandas as pd
from datetime import datetime, timedelta
from fastapi import FastAPI, UploadFile, File, Depends, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func
import models
from database import engine, SessionLocal

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

COL_MAP = {
    "访客数": "visitor_count",
    "商品详情页跳出率": "bounce_rate",
    "支付金额": "pay_amount",
    "支付转化率": "pay_conversion",
    "成功退款率(金额)": "refund_rate_amount",
    "核销率(金额)": "redeem_rate_amount",
    "店播支付金额": "live_pay_amount",
    "价格倍数": "price_multiplier",
    "浏览量": "page_views",
    "访客平均价值": "avg_visitor_value",
    "下单用户数": "order_users",
    "下单金额": "order_amount",
    "下单转化率": "order_conversion",
    "支付用户数": "pay_users",
    "支付订单数": "pay_orders",
    "支付件数": "pay_items",
    "下单用户支付率": "order_user_pay_rate",
    "静默支付转化率": "silent_pay_conversion",
    "成功退款件数": "refund_items",
    "成功退款金额": "refund_amount",
    "成功退款率(件)": "refund_rate_item",
    "核销件数": "redeem_items",
    "核销金额": "redeem_amount",
    "核销率(件)": "redeem_rate_item",
    "店播支付订单量": "live_pay_orders",
    "店播支付用户数": "live_pay_users",
    "店播支付券量": "live_pay_coupons",
    "店播消费金额": "live_consume_amount",
    "店播消费券量": "live_consume_coupons",
    "店播消费订单量": "live_consume_orders",
    "店播退款金额": "live_refund_amount",
    "店播消费率": "live_consume_rate",
    "店播退款率": "live_refund_rate",
}

@app.post("/upload")
async def upload_file(date: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")
        
    content = await file.read()
    try:
        df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read excel: {str(e)}")
        
    if "产品编号" not in df.columns or "商品名称" not in df.columns:
        raise HTTPException(status_code=400, detail="Excel must contain '产品编号' and '商品名称'")

    # Replace invalid values and NaNs with 0
    df = df.fillna(0)
    for col in df.columns:
        if df[col].dtype == 'object' and col not in ['产品编号', '商品名称']:
            # Maybe some strings like '-' or 'N/A' exist
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            
    # Remove existing data for that day to avoid duplication
    db.query(models.DailyData).filter(models.DailyData.date == target_date).delete()

    records_to_insert = []
    
    # Process each row
    for _, row in df.iterrows():
        product_id = str(row["产品编号"])
        product_name = str(row["商品名称"])
        
        # update Product dictionary
        product = db.query(models.Product).filter(models.Product.id == product_id).first()
        if product:
            product.name = product_name # update to latest name
        else:
            product = models.Product(id=product_id, name=product_name)
            db.add(product)
            
        data_kwargs = {
            "product_id": product_id,
            "date": target_date
        }
        for excel_col, model_col in COL_MAP.items():
            if excel_col in row:
                data_kwargs[model_col] = float(row[excel_col]) if pd.notnull(row[excel_col]) else 0.0
                
        records_to_insert.append(models.DailyData(**data_kwargs))
        
    db.bulk_save_objects(records_to_insert)
    db.commit()
    
    return {"message": "Data uploaded successfully"}

@app.post("/upload_orders")
def upload_orders(file: UploadFile = File(...), date: str = Form(...)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    contents = file.file.read()
    try:
        df = pd.read_excel(io.BytesIO(contents), header=2)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading Excel file: {str(e)}")
        
    required_cols = ['旅游线路', '利润']
    for col in required_cols:
        if col not in df.columns:
            raise HTTPException(status_code=400, detail=f"Order Excel must contain '{col}' column.")

    # Group by tourism route (商品名称) and sum the profit
    profit_by_route = df.groupby('旅游线路')['利润'].sum().to_dict()

    db = SessionLocal()
    try:
        import hashlib
        for route_name, total_profit in profit_by_route.items():
            if pd.isna(route_name):
                continue

            product = db.query(models.Product).filter(models.Product.name == str(route_name).strip()).first()
            if not product:
                pid = "order_" + hashlib.md5(str(route_name).encode()).hexdigest()[:8]
                product = models.Product(id=pid, name=str(route_name).strip())
                db.add(product)
                db.commit()

            daily_data = db.query(models.DailyData).filter_by(product_id=product.id, date=target_date).first()
            if daily_data:
                daily_data.profit = float(total_profit) if pd.notnull(total_profit) else 0.0
            else:
                new_data = models.DailyData(
                    product_id=product.id,
                    date=target_date,
                    profit=float(total_profit) if pd.notnull(total_profit) else 0.0
                )
                db.add(new_data)

        db.commit()
    finally:
        db.close()

    return {"message": "Order data uploaded successfully"}

@app.get("/dates")
def get_dates(db: Session = Depends(get_db)):
    dates = db.query(models.DailyData.date).distinct().order_by(models.DailyData.date.desc()).all()
    return {"dates": [d[0].strftime("%Y-%m-%d") for d in dates]}

@app.get("/products")
def get_products(startDate: str = None, endDate: str = None, db: Session = Depends(get_db)):
    query = db.query(models.Product)
    if startDate and endDate:
        try:
            start = datetime.strptime(startDate, "%Y-%m-%d").date()
            end = datetime.strptime(endDate, "%Y-%m-%d").date()
            query = query.join(models.DailyData, models.Product.id == models.DailyData.product_id)\
                         .filter(models.DailyData.date >= start, models.DailyData.date <= end)\
                         .distinct()
        except ValueError:
            pass # fallback to all products if date invalid
    products = query.all()
    return [{"id": p.id, "name": p.name} for p in products]

def compute_total_rate(db, date_val):
    # 总的支付金额，核销率（金额），支付订单数，核销件数，核销金额，店播退款金额， 店播退款率，核销率(件)
    # 计算核销率(金额) = 核销金额 / 支付金额
    # 计算核销率(件) = 核销件数 / 支付件数
    # 计算店播退款率 = 店播退款金额 / 店播消费金额
    # 支付订单数 = sum(pay_orders)
    # 核销件数 = sum(redeem_items)
    # 核销金额 = sum(redeem_amount)
    # 店播退款金额 = sum(live_refund_amount)
    
    result = db.query(
        func.sum(models.DailyData.pay_amount).label('pay_amount'),
        func.sum(models.DailyData.pay_orders).label('pay_orders'),
        func.sum(models.DailyData.pay_items).label('pay_items'),
        func.sum(models.DailyData.redeem_items).label('redeem_items'),
        func.sum(models.DailyData.redeem_amount).label('redeem_amount'),
        func.sum(models.DailyData.live_refund_amount).label('live_refund_amount'),
        func.sum(models.DailyData.live_consume_amount).label('live_consume_amount'),
        func.sum(models.DailyData.profit).label('profit'),
    ).filter(models.DailyData.date == date_val).first()
    
    if not result or result.pay_amount is None:
         return None
         
    pay_amount = float(result.pay_amount or 0)
    pay_orders = float(result.pay_orders or 0)
    pay_items = float(result.pay_items or 0)
    redeem_items = float(result.redeem_items or 0)
    redeem_amount = float(result.redeem_amount or 0)
    live_refund_amount = float(result.live_refund_amount or 0)
    live_consume_amount = float(result.live_consume_amount or 0)
    profit = float(result.profit or 0)
    
    redeem_rate_amount = (redeem_amount / pay_amount * 100) if pay_amount > 0 else 0
    redeem_rate_item = (redeem_items / pay_items * 100) if pay_items > 0 else 0
    live_refund_rate = (live_refund_amount / live_consume_amount * 100) if live_consume_amount > 0 else 0
    profit_margin = (profit / redeem_amount * 100) if redeem_amount > 0 else 0
    
    return {
        "pay_amount": pay_amount,
        "redeem_rate_amount": redeem_rate_amount,
        "pay_orders": pay_orders,
        "redeem_items": redeem_items,
        "redeem_amount": redeem_amount,
        "live_refund_amount": live_refund_amount,
        "live_refund_rate": live_refund_rate,
        "redeem_rate_item": redeem_rate_item,
        "profit": profit,
        "profit_margin": profit_margin
    }

@app.get("/summary")
def get_summary(date: str, db: Session = Depends(get_db)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
         raise HTTPException(status_code=400, detail="Invalid date")
         
    calc_today = compute_total_rate(db, target_date)
    if not calc_today:
        return {"today": None, "yesterday": None, "has_yesterday": False}
        
    yesterday_date = target_date - timedelta(days=1)
    calc_yesterday = compute_total_rate(db, yesterday_date)
    
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
        "has_yesterday": bool(calc_yesterday)
    }

@app.get("/data")
def get_data(startDate: str, endDate: str, productIds: str = None, db: Session = Depends(get_db)):
    try:
        start = datetime.strptime(startDate, "%Y-%m-%d").date()
        end = datetime.strptime(endDate, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid dates")
        
    query = db.query(models.DailyData, models.Product.name.label("product_name"))\
             .join(models.Product, models.DailyData.product_id == models.Product.id)\
             .filter(models.DailyData.date >= start, models.DailyData.date <= end)
             
    if productIds:
        ids_list = [i.strip() for i in productIds.split(",")]
        query = query.filter(models.DailyData.product_id.in_(ids_list))
        
    results = query.all()
    
    out = []
    for r, pname in results:
        row_dict = {c.name: getattr(r, c.name) for c in r.__table__.columns}
        row_dict["product_name"] = pname
        row_dict["date"] = row_dict["date"].strftime("%Y-%m-%d")
        out.append(row_dict)
        
    return out

@app.delete("/data")
def delete_data(date: str, db: Session = Depends(get_db)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
         raise HTTPException(status_code=400, detail="Invalid date format")
         
    deleted = db.query(models.DailyData).filter(models.DailyData.date == target_date).delete()
    db.commit()
    
    if deleted > 0:
        return {"message": f"成功取消绑定并删除了 {date} 的所有数据 ({deleted}条记录)"}
    else:
        return {"message": f"{date} 当天没有绑定的数据可删除"}

@app.delete("/data/commodity")
def delete_commodity_data(date: str, db: Session = Depends(get_db)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    records = db.query(models.DailyData).filter(models.DailyData.date == target_date).all()
    count = 0
    for r in records:
        if not r.profit or r.profit == 0:
            db.delete(r)
        else:
            for col in r.__table__.columns:
                if col.name not in ["id", "product_id", "date", "profit"]:
                    setattr(r, col.name, 0)
        count += 1
    db.commit()
    
    if count > 0:
        return {"message": f"成功清空了 {date} 的商品常规数据"}
    else:
        return {"message": f"{date} 当天没有相应的商品常规数据"}

@app.delete("/data/order")
def delete_order_data(date: str, db: Session = Depends(get_db)):
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    records = db.query(models.DailyData).filter(models.DailyData.date == target_date).all()
    count = 0
    for r in records:
        is_empty = True
        for col in r.__table__.columns:
            if col.name not in ["id", "product_id", "date", "profit"]:
                val = getattr(r, col.name)
                if val and val != 0:
                    is_empty = False
                    break
        if is_empty:
            db.delete(r)
        else:
            r.profit = 0
        count += 1
    db.commit()
    
    if count > 0:
        return {"message": f"成功清空了 {date} 的订单利润数据"}
    else:
        return {"message": f"{date} 当天没有相应的订单利润数据"}

import os

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

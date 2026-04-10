"""
Regression test suite — verify that modified code produces consistent results.

Changed areas tested:
  1. _run_migrations() — rollback safety
  2. ProductDateIndex (TTL cache) — product listing
  3. refresh_daily_product_summary() — SQL INSERT vs Python loop
  4. compare/aggregate overall_totals — Python vs separate DB query
  5. compare/aggregate per-product rows — weighted avg vs simple avg
  6. compare/trend — backward compatibility
  7. compute_display_metric_value — all metric paths
"""

import sys
import os
import math
from datetime import date, datetime, timedelta

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

TEST_DB_URL = "sqlite:///:memory:"
test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSession = sessionmaker(bind=test_engine)

import database
database.engine = test_engine
database.SessionLocal = TestSession

import models
models.Base.metadata.create_all(bind=test_engine)
import main

# ---------------------------------------------------------------------------
def make_db():
    return TestSession()

def insert_product(db, product_id, name):
    db.execute(text("INSERT OR IGNORE INTO products (id, name) VALUES (:id, :name)"),
               {"id": product_id, "name": name})
    db.commit()

def insert_daily_data(db, product_id, target_date, **kwargs):
    data = models.DailyData(product_id=product_id, date=date.fromisoformat(target_date), **kwargs)
    db.add(data)
    db.commit()

def seed_test_data(db):
    insert_product(db, "prod_A", "产品A")
    insert_product(db, "prod_B", "产品B")
    insert_product(db, "prod_C", "产品C")

    # Product A — Day 1
    insert_daily_data(db, "prod_A", "2025-01-01",
        visitor_count=1000, bounce_rate=0.35, page_views=3000,
        pay_amount=50000, pay_users=100,
        order_users=120, live_pay_amount=20000,
        live_pay_users=50, order_amount=55000,
        price_multiplier=1.2, silent_pay_conversion=0.05,
        live_consume_rate=0.4, pay_orders=110, pay_items=200,
        redeem_items=10, redeem_amount=500, refund_amount=1000,
        refund_items=5, live_refund_amount=200,
        live_consume_amount=8000, profit=15000)

    # Product A — Day 2
    insert_daily_data(db, "prod_A", "2025-01-02",
        visitor_count=1200, bounce_rate=0.30, page_views=3600,
        pay_amount=60000, pay_users=130,
        order_users=140, live_pay_amount=25000,
        live_pay_users=60, order_amount=65000,
        price_multiplier=1.3, silent_pay_conversion=0.06,
        live_consume_rate=0.45, pay_orders=130, pay_items=240,
        redeem_items=12, redeem_amount=600, refund_amount=1200,
        refund_items=6, live_refund_amount=250,
        live_consume_amount=9000, profit=18000)

    # Product B — Day 1
    insert_daily_data(db, "prod_B", "2025-01-01",
        visitor_count=800, bounce_rate=0.40, page_views=2000,
        pay_amount=30000, pay_users=60,
        order_users=70, live_pay_amount=10000,
        live_pay_users=30, order_amount=32000,
        price_multiplier=1.1, silent_pay_conversion=0.04,
        live_consume_rate=0.35, pay_orders=65, pay_items=120,
        redeem_items=5, redeem_amount=300, refund_amount=500,
        refund_items=3, live_refund_amount=100,
        live_consume_amount=5000, profit=10000)

    # Product B — Day 2
    insert_daily_data(db, "prod_B", "2025-01-02",
        visitor_count=900, bounce_rate=0.38, page_views=2400,
        pay_amount=35000, pay_users=70,
        order_users=80, live_pay_amount=12000,
        live_pay_users=35, order_amount=36000,
        price_multiplier=1.15, silent_pay_conversion=0.045,
        live_consume_rate=0.38, pay_orders=75, pay_items=140,
        redeem_items=6, redeem_amount=350, refund_amount=600,
        refund_items=4, live_refund_amount=120,
        live_consume_amount=5500, profit=12000)

    # Product C — Day 1 only
    insert_daily_data(db, "prod_C", "2025-01-01",
        visitor_count=500, bounce_rate=0.50, page_views=1000,
        pay_amount=15000, pay_users=30,
        order_users=35, live_pay_amount=5000,
        live_pay_users=15, order_amount=16000,
        price_multiplier=1.0, silent_pay_conversion=0.03,
        live_consume_rate=0.30, pay_orders=32, pay_items=60,
        redeem_items=3, redeem_amount=200, refund_amount=300,
        refund_items=2, live_refund_amount=50,
        live_consume_amount=3000, profit=5000)

    main.refresh_materialized_summaries(db, date(2025, 1, 1))
    db.commit()
    main.refresh_materialized_summaries(db, date(2025, 1, 2))
    db.commit()


PASS_COUNT = 0
FAIL_COUNT = 0
FAIL_DETAILS = []

def assert_close(name, actual, expected, tol=1e-6):
    global PASS_COUNT, FAIL_COUNT
    if expected == 0:
        ok = abs(actual) < tol
    else:
        ok = abs(actual - expected) / max(abs(expected), 1e-12) < tol
    if ok:
        PASS_COUNT += 1
    else:
        FAIL_COUNT += 1
        msg = f"  FAIL: {name} — got {actual}, expected {expected}"
        print(msg); FAIL_DETAILS.append(msg)

def assert_equal(name, actual, expected):
    global PASS_COUNT, FAIL_COUNT
    if actual == expected:
        PASS_COUNT += 1
    else:
        FAIL_COUNT += 1
        msg = f"  FAIL: {name} — got {actual!r}, expected {expected!r}"
        print(msg); FAIL_DETAILS.append(msg)

def assert_true(name, condition):
    global PASS_COUNT, FAIL_COUNT
    if condition:
        PASS_COUNT += 1
    else:
        FAIL_COUNT += 1
        msg = f"  FAIL: {name}"
        print(msg); FAIL_DETAILS.append(msg)


# ==== TEST 1: Migrations ====
def test_migrations():
    print("\n[TEST 1] Migrations — schema integrity")
    with test_engine.connect() as conn:
        cols = {r[1] for r in conn.execute(text("PRAGMA table_info(daily_data)")).fetchall()}
        assert_true("daily_data.profit exists", "profit" in cols)
        cols2 = {r[1] for r in conn.execute(text("PRAGMA table_info(pending_orders)")).fetchall()}
        assert_true("pending_orders.salesperson exists", "salesperson" in cols2)
        tables = {r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()}
        assert_true("pending_orders table", "pending_orders" in tables)
        assert_true("daily_product_summaries table", "daily_product_summaries" in tables)

# ==== TEST 2: ProductDateIndex ====
def test_product_index():
    print("\n[TEST 2] ProductDateIndex — product listing")
    db = make_db()
    try:
        main.PRODUCT_INDEX.clear()
        all_p = main.PRODUCT_INDEX.get_products(db)
        assert_equal("3 products total", len(all_p), 3)
        names = [p["name"] for p in all_p]
        assert_equal("Sorted", names, sorted(names))

        p_d1 = main.PRODUCT_INDEX.get_products(db, date(2025,1,1), date(2025,1,1))
        assert_equal("Day 1: 3 prods", len(p_d1), 3)

        p_d2 = main.PRODUCT_INDEX.get_products(db, date(2025,1,2), date(2025,1,2))
        assert_equal("Day 2: 2 prods", len(p_d2), 2)
        assert_true("C not in day 2", "产品C" not in {p["name"] for p in p_d2})

        # Cache hit
        main.PRODUCT_INDEX.clear()
        a = main.PRODUCT_INDEX.get_products(db)
        b = main.PRODUCT_INDEX.get_products(db)
        assert_equal("Cache hit", a, b)
    finally:
        db.close()

# ==== TEST 3: Materialization ====
def test_materialization():
    print("\n[TEST 3] refresh_daily_product_summary — data")
    db = make_db()
    try:
        c1 = db.execute(text("SELECT COUNT(*) FROM daily_product_summaries WHERE date='2025-01-01'")).scalar()
        assert_equal("D1 summaries", c1, 3)
        c2 = db.execute(text("SELECT COUNT(*) FROM daily_product_summaries WHERE date='2025-01-02'")).scalar()
        assert_equal("D2 summaries", c2, 2)

        row = db.execute(text(
            "SELECT visitor_count, bounce_rate, pay_amount, profit, product_name "
            "FROM daily_product_summaries WHERE product_id='prod_A' AND date='2025-01-01'"
        )).fetchone()
        assert_close("A d1 vc", row[0], 1000)
        assert_close("A d1 br", row[1], 0.35)
        assert_close("A d1 pa", row[2], 50000)
        assert_close("A d1 profit", row[3], 15000)
        assert_equal("A d1 name", row[4], "产品A")

        # Idempotency
        main.refresh_daily_product_summary(db, date(2025,1,1))
        db.commit()
        c = db.execute(text("SELECT COUNT(*) FROM daily_product_summaries WHERE date='2025-01-01'")).scalar()
        assert_equal("Idempotent", c, 3)

        # No NULLs
        r = db.execute(text(
            "SELECT * FROM daily_product_summaries WHERE product_id='prod_B' AND date='2025-01-01'"
        )).fetchone()
        for i, val in enumerate(r):
            if i >= 3:
                assert_true(f"B d1 col[{i}] != None", val is not None)
    finally:
        db.close()

# ==== TEST 4: Aggregate — sum metrics ====
def test_agg_sum():
    print("\n[TEST 4] Aggregate — sum metrics")
    db = make_db()
    try:
        r = main.get_compare_aggregate(startDate="2025-01-01", endDate="2025-01-02",
                                        metrics="visitor_count,pay_amount,profit", productIds=None, db=db)
        ov = r["overall_totals"]
        assert_close("ov vc", ov["visitor_count"], 4400)
        assert_close("ov pa", ov["pay_amount"], 190000)
        assert_close("ov profit", ov["profit"], 60000)

        assert_equal("3 rows", len(r["rows"]), 3)
        ra = next(x for x in r["rows"] if x["product_id"] == "prod_A")
        # Per-product uses {metric}_total key (via compute_display_metric_value)
        assert_close("A vc_total", ra["visitor_count_total"], 2200)
        assert_close("A pa_total", ra["pay_amount_total"], 110000)
        assert_equal("A days", ra["days_count"], 2)

        rc = next(x for x in r["rows"] if x["product_id"] == "prod_C")
        assert_close("C vc_total", rc["visitor_count_total"], 500)
        assert_equal("C days", rc["days_count"], 1)
    finally:
        db.close()

# ==== TEST 5: Aggregate — ratio metrics ====
def test_agg_ratio():
    print("\n[TEST 5] Aggregate — ratio metrics")
    db = make_db()
    try:
        r = main.get_compare_aggregate(startDate="2025-01-01", endDate="2025-01-02",
                                        metrics="order_conversion,avg_visitor_value,pay_conversion", productIds=None, db=db)
        ov = r["overall_totals"]
        total_ou, total_vc, total_pa, total_pu = 445, 4400, 190000, 390
        assert_close("ov oc", ov["order_conversion"], total_ou/total_vc*100, tol=1e-4)
        assert_close("ov avv", ov["avg_visitor_value"], total_pa/total_vc, tol=1e-4)
        assert_close("ov pc", ov["pay_conversion"], total_pu/total_vc*100, tol=1e-4)

        rb = next(x for x in r["rows"] if x["product_id"] == "prod_B")
        assert_close("B oc", rb["order_conversion_total"], (70+80)/(800+900)*100, tol=1e-4)
        assert_close("B avv", rb["avg_visitor_value_total"], (30000+35000)/(800+900), tol=1e-4)
    finally:
        db.close()

# ==== TEST 6: Aggregate — weighted avg metrics (KEY CHANGE) ====
def test_agg_weighted():
    print("\n[TEST 6] Aggregate — weighted avg (KEY CHANGE)")
    db = make_db()
    try:
        r = main.get_compare_aggregate(startDate="2025-01-01", endDate="2025-01-02",
                                        metrics="bounce_rate,price_multiplier,silent_pay_conversion,live_consume_rate",
                                        productIds=None, db=db)
        ov = r["overall_totals"]

        # bounce_rate weighted by visitor_count
        num_br = 0.35*1000 + 0.30*1200 + 0.40*800 + 0.38*900 + 0.50*500
        den_br = 4400
        assert_close("ov br", ov["bounce_rate"], num_br/den_br, tol=1e-4)

        # price_multiplier weighted by pay_users
        num_pm = 1.2*100 + 1.3*130 + 1.1*60 + 1.15*70 + 1.0*30
        den_pm = 390
        assert_close("ov pm", ov["price_multiplier"], num_pm/den_pm, tol=1e-4)

        # silent_pay_conversion weighted by visitor_count
        num_spc = 0.05*1000 + 0.06*1200 + 0.04*800 + 0.045*900 + 0.03*500
        assert_close("ov spc", ov["silent_pay_conversion"], num_spc/den_br, tol=1e-4)

        # live_consume_rate weighted by live_pay_users
        num_lcr = 0.4*50 + 0.45*60 + 0.35*30 + 0.38*35 + 0.30*15
        den_lcr = 190
        assert_close("ov lcr", ov["live_consume_rate"], num_lcr/den_lcr, tol=1e-4)

        # Per-product weighted avg
        ra = next(x for x in r["rows"] if x["product_id"] == "prod_A")
        exp_a_br = (0.35*1000 + 0.30*1200) / (1000 + 1200)
        assert_close("A br weighted", ra["bounce_rate_total"], exp_a_br, tol=1e-4)

        rb = next(x for x in r["rows"] if x["product_id"] == "prod_B")
        exp_b_pm = (1.1*60 + 1.15*70) / (60 + 70)
        assert_close("B pm weighted", rb["price_multiplier_total"], exp_b_pm, tol=1e-4)

        # Single-day product: weighted avg == raw value
        rc = next(x for x in r["rows"] if x["product_id"] == "prod_C")
        assert_close("C br single", rc["bounce_rate_total"], 0.50, tol=1e-4)
    finally:
        db.close()

# ==== TEST 7: Aggregate — product filter ====
def test_agg_filter():
    print("\n[TEST 7] Aggregate — product filter")
    db = make_db()
    try:
        r = main.get_compare_aggregate(startDate="2025-01-01", endDate="2025-01-02",
                                        metrics="visitor_count,pay_amount", productIds="prod_A", db=db)
        assert_equal("1 row", len(r["rows"]), 1)
        assert_close("filtered vc", r["overall_totals"]["visitor_count"], 2200)

        r2 = main.get_compare_aggregate(startDate="2025-01-01", endDate="2025-01-02",
                                         metrics="visitor_count", productIds="prod_A,prod_B", db=db)
        assert_equal("2 rows", len(r2["rows"]), 2)
        assert_close("multi vc", r2["overall_totals"]["visitor_count"], 3900)
    finally:
        db.close()

# ==== TEST 8: Aggregate — empty ====
def test_agg_empty():
    print("\n[TEST 8] Aggregate — empty range")
    db = make_db()
    try:
        r = main.get_compare_aggregate(startDate="2025-06-01", endDate="2025-06-30",
                                        metrics="visitor_count,bounce_rate,pay_amount", productIds=None, db=db)
        assert_equal("no rows", len(r["rows"]), 0)
        assert_close("empty vc", r["overall_totals"]["visitor_count"], 0)
        assert_close("empty br", r["overall_totals"]["bounce_rate"], 0)
    finally:
        db.close()

# ==== TEST 9: Aggregate — single prod/day ====
def test_agg_single():
    print("\n[TEST 9] Aggregate — single product single day")
    db = make_db()
    try:
        r = main.get_compare_aggregate(startDate="2025-01-01", endDate="2025-01-01",
                                        metrics="visitor_count,bounce_rate,order_conversion",
                                        productIds="prod_C", db=db)
        ov = r["overall_totals"]
        assert_close("vc", ov["visitor_count"], 500)
        assert_close("br", ov["bounce_rate"], 0.50, tol=1e-4)
        assert_close("oc", ov["order_conversion"], 35.0/500.0*100, tol=1e-4)
        assert_equal("days", r["rows"][0]["days_count"], 1)
    finally:
        db.close()

# ==== TEST 10: Trend — backward compat ====
def test_trend():
    print("\n[TEST 10] Trend — backward compat")
    db = make_db()
    try:
        r = main.get_compare_trend(startDate="2025-01-01", endDate="2025-01-02",
                                    metric="visitor_count", productIds=None, db=db)
        assert_true("returns list", isinstance(r, list))
        assert_true("has data", len(r) > 0)
        assert_true("has keys", all(k in r[0] for k in ["product_id", "date", "value"]))

        r2 = main.get_compare_trend(startDate="2025-01-01", endDate="2025-01-02",
                                     metric="visitor_count", productIds=None, includeDates=True, db=db)
        assert_true("dict w/ dates", isinstance(r2, dict) and "dates" in r2)
        assert_equal("2 dates", len(r2["dates"]), 2)

        r3 = main.get_compare_trend(startDate="2025-01-01", endDate="2025-01-02",
                                     metric="visitor_count", productIds="prod_A", db=db)
        assert_equal("filter A", {x["product_id"] for x in r3}, {"prod_A"})
        vals = {x["date"]: x["value"] for x in r3}
        assert_close("A d1 val", vals.get("2025-01-01", 0), 1000)
        assert_close("A d2 val", vals.get("2025-01-02", 0), 1200)
    finally:
        db.close()

# ==== TEST 11: compute_display_metric_value ====
def test_display_metric():
    print("\n[TEST 11] compute_display_metric_value")
    sums = {"visitor_count": 4400, "pay_amount": 190000, "order_users": 445,
            "pay_users": 390, "pay_items": 760, "refund_items": 20,
            "refund_amount": 3600, "redeem_items": 36, "redeem_amount": 1950,
            "live_refund_amount": 720, "live_consume_amount": 30500}
    avgs = {"bounce_rate": 0.36, "price_multiplier": 1.2,
            "silent_pay_conversion": 0.048, "live_consume_rate": 0.39}

    assert_close("vc", main.compute_display_metric_value("visitor_count", sums, avgs), 4400)
    assert_close("oc", main.compute_display_metric_value("order_conversion", sums, avgs), 445/4400*100, tol=1e-4)
    assert_close("avv", main.compute_display_metric_value("avg_visitor_value", sums, avgs), 190000/4400, tol=1e-4)
    assert_close("br", main.compute_display_metric_value("bounce_rate", sums, avgs), 0.36)
    assert_close("pm", main.compute_display_metric_value("price_multiplier", sums, avgs), 1.2)
    # Zero denom
    assert_close("zero", main.compute_display_metric_value("order_conversion", {"visitor_count": 0, "order_users": 100}, {}), 0)

# ==== TEST 12: /summary endpoint ====
def test_summary():
    print("\n[TEST 12] /summary endpoint")
    db = make_db()
    try:
        r = main.get_summary(startDate="2025-01-01", endDate="2025-01-02", db=db)
        assert_true("has today", "today" in r)
        # /summary uses daily_summaries table which stores TOTAL_RATE_FIELDS
        assert_close("sum pa", r["today"].get("pay_amount", 0), 190000)
        assert_close("sum profit", r["today"].get("profit", 0), 60000)
    finally:
        db.close()

# ==== TEST 13: Zero-weight edge ====
def test_zero_weight():
    print("\n[TEST 13] Zero-weight edge case")
    db = make_db()
    try:
        insert_product(db, "prod_Z", "零权重")
        insert_daily_data(db, "prod_Z", "2025-02-01",
            visitor_count=0, bounce_rate=0.99, pay_amount=0, pay_users=0,
            live_pay_users=0, price_multiplier=5.0, silent_pay_conversion=0.99,
            live_consume_rate=0.99)
        main.refresh_materialized_summaries(db, date(2025, 2, 1))
        db.commit()

        r = main.get_compare_aggregate(startDate="2025-02-01", endDate="2025-02-01",
                                        metrics="bounce_rate,price_multiplier", productIds="prod_Z", db=db)
        assert_close("zero br", r["overall_totals"]["bounce_rate"], 0.0, tol=1e-4)
        assert_close("zero pm", r["overall_totals"]["price_multiplier"], 0.0, tol=1e-4)
    finally:
        db.close()

# ==== TEST 14: Mixed metrics ====
def test_mixed():
    print("\n[TEST 14] Mixed metric types")
    db = make_db()
    try:
        r = main.get_compare_aggregate(startDate="2025-01-01", endDate="2025-01-02",
                                        metrics="visitor_count,bounce_rate,pay_amount,order_conversion,price_multiplier",
                                        productIds=None, db=db)
        ov = r["overall_totals"]
        assert_close("mix vc", ov["visitor_count"], 4400)
        assert_close("mix pa", ov["pay_amount"], 190000)
        assert_close("mix oc", ov["order_conversion"], 445/4400*100, tol=1e-4)
        num_br = 0.35*1000 + 0.30*1200 + 0.40*800 + 0.38*900 + 0.50*500
        assert_close("mix br", ov["bounce_rate"], num_br/4400, tol=1e-4)
        num_pm = 1.2*100 + 1.3*130 + 1.1*60 + 1.15*70 + 1.0*30
        assert_close("mix pm", ov["price_multiplier"], num_pm/390, tol=1e-4)
    finally:
        db.close()

# ==== TEST 15: Weighted avg reconstruction ====
def test_reconstruction():
    print("\n[TEST 15] Weighted avg reconstruction from per-product data")
    db = make_db()
    try:
        r = main.get_compare_aggregate(startDate="2025-01-01", endDate="2025-01-02",
                                        metrics="bounce_rate,price_multiplier,visitor_count,pay_users,live_pay_users",
                                        productIds=None, db=db)
        rows = r["rows"]
        ov = r["overall_totals"]

        # Reconstruct: overall bounce_rate = sum(per_product_br * per_product_vc) / sum(per_product_vc)
        # Note: per-product total for NON_ADDITIVE fields uses compute_display_metric_value
        # which returns the weighted avg. For sum fields, it returns the total.
        total_br_num = sum(row["bounce_rate_total"] * row["visitor_count_total"] for row in rows)
        total_br_den = sum(row["visitor_count_total"] for row in rows)
        recon_br = total_br_num / total_br_den if total_br_den else 0
        assert_close("recon br", ov["bounce_rate"], recon_br, tol=1e-3)

        total_pm_num = sum(row["price_multiplier_total"] * row["pay_users_total"] for row in rows)
        total_pm_den = sum(row["pay_users_total"] for row in rows)
        recon_pm = total_pm_num / total_pm_den if total_pm_den else 0
        assert_close("recon pm", ov["price_multiplier"], recon_pm, tol=1e-3)
    finally:
        db.close()

# ==== TEST 16: Single metric queries ====
def test_single_metrics():
    print("\n[TEST 16] Single metric queries")
    db = make_db()
    try:
        for m in ["visitor_count", "bounce_rate", "pay_amount", "profit",
                   "order_conversion", "avg_visitor_value", "price_multiplier"]:
            r = main.get_compare_aggregate(startDate="2025-01-01", endDate="2025-01-02",
                                            metrics=m, productIds=None, db=db)
            assert_true(f"{m} rows>0", len(r["rows"]) > 0)
            assert_true(f"{m} in overall", m in r["overall_totals"])
    finally:
        db.close()

# ==== TEST 17: compute_total_rate ====
def test_total_rate():
    print("\n[TEST 17] compute_total_rate")
    db = make_db()
    try:
        rate = main.compute_total_rate(db, "2025-01-01", "2025-01-02")
        assert_true("dict", isinstance(rate, dict))
        # compute_total_rate returns pay_amount, pay_orders, etc. + computed rates
        assert_close("rate pa", rate["pay_amount"], 190000)
        assert_close("rate profit", rate["profit"], 60000)
        total_ri = 5+6+3+4+2  # = 20
        assert_close("rate refund_items", rate["refund_items"], total_ri)
    finally:
        db.close()

# ==== TEST 18: Refund rate metrics ====
def test_refund_rates():
    print("\n[TEST 18] Refund rate metrics")
    db = make_db()
    try:
        r = main.get_compare_aggregate(startDate="2025-01-01", endDate="2025-01-02",
                                        metrics="refund_rate_item,refund_rate_amount,live_refund_rate",
                                        productIds=None, db=db)
        ov = r["overall_totals"]
        total_ri = 5+6+3+4+2  # refund_items = 20
        total_pi = 200+240+120+140+60  # pay_items = 760
        total_ra = 1000+1200+500+600+300  # refund_amount = 3600
        total_pa = 190000
        total_lra = 200+250+100+120+50  # live_refund_amount = 720
        total_lca = 8000+9000+5000+5500+3000  # live_consume_amount = 30500

        assert_close("rfi", ov["refund_rate_item"], total_ri/total_pi*100, tol=1e-4)
        assert_close("rfa", ov["refund_rate_amount"], total_ra/total_pa*100, tol=1e-4)
        assert_close("lfr", ov["live_refund_rate"], total_lra/total_lca*100, tol=1e-4)
    finally:
        db.close()


# ===========================================================================
def main_test():
    global PASS_COUNT, FAIL_COUNT
    print("=" * 70)
    print("REGRESSION TEST SUITE — Backend Logic Verification")
    print("=" * 70)

    db = make_db()
    seed_test_data(db)
    db.close()

    tests = [test_migrations, test_product_index, test_materialization,
             test_agg_sum, test_agg_ratio, test_agg_weighted, test_agg_filter,
             test_agg_empty, test_agg_single, test_trend, test_display_metric,
             test_summary, test_zero_weight, test_mixed, test_reconstruction,
             test_single_metrics, test_total_rate, test_refund_rates]

    for t in tests:
        try:
            t()
        except Exception as ex:
            FAIL_COUNT += 1
            msg = f"  EXCEPTION in {t.__name__}: {ex}"
            print(msg); FAIL_DETAILS.append(msg)

    print("\n" + "=" * 70)
    print(f"RESULTS: {PASS_COUNT} passed, {FAIL_COUNT} failed")
    print("=" * 70)

    if FAIL_COUNT > 0:
        print("\nFailures:")
        for m in FAIL_DETAILS:
            print(m)
        sys.exit(1)
    else:
        print("\nPASSED: All tests passed!")
        sys.exit(0)

if __name__ == "__main__":
    main_test()

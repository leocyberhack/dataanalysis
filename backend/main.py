import os
import hashlib

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

import models
from database import engine
from deps import get_db
from routes_compare import (
    get_compare_aggregate,
    get_compare_report,
    get_compare_trend,
    get_poi_insight,
    router as compare_router,
)
from routes_deep_analysis import (
    get_deep_analysis,
    router as deep_analysis_router,
)
from routes_query import (
    get_data,
    get_date_status,
    get_dates,
    get_poi_options,
    get_products,
    get_summary,
    router as query_router,
)
from routes_review import (
    approve_order,
    delete_pending_order,
    get_pending_orders,
    router as review_router,
    update_pending_order,
)
from routes_plans import (
    create_plan,
    delete_plan,
    get_plans,
    router as plans_router,
    update_plan,
)
from routes_upload import (
    delete_data_batch,
    delete_commodity_data,
    delete_data,
    delete_order_data,
    router as upload_router,
    upload_batch,
    upload_file,
    upload_orders,
)
from schemas import ApproveOrderRequest, UpdateProfitRequest
from services import (
    COL_MAP,
    COMPARE_METRIC_FIELDS,
    COMPARE_TOTAL_DEPENDENCIES,
    DAILY_PRODUCT_SUMMARY_FIELDS,
    NON_ADDITIVE_AVERAGE_FIELDS,
    PRODUCT_INDEX,
    TOTAL_RATE_FIELDS,
    TREND_AVERAGE_FIELDS,
    ProductDateIndex,
    _run_migrations,
    apply_product_filter,
    build_order_product_id,
    clear_runtime_caches,
    get_pois,
    get_product_ids_for_pois,
    get_response_cache_token,
    compute_display_metric_value,
    compute_total_rate,
    ensure_daily_product_summaries,
    ensure_daily_summaries,
    has_non_profit_data,
    parse_poi_names,
    normalize_float_cell,
    normalize_string_cell,
    parse_compare_metrics,
    parse_product_ids,
    refresh_daily_product_summary,
    refresh_daily_summary,
    refresh_materialized_summaries,
    safe_divide,
)


models.Base.metadata.create_all(bind=engine)
_run_migrations()
ensure_daily_summaries()
ensure_daily_product_summaries()


app = FastAPI()

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.middleware("http")
async def add_cache_headers(request, call_next):
    cache_ttl_by_path = {
        "/dates": 30,
        "/date_status": 30,
        "/products": 60,
        "/pois": 60,
        "/plans": 30,
        "/summary": 30,
        "/summary/rankings": 30,
        "/compare/aggregate": 60,
        "/compare/trend": 60,
        "/compare/report": 60,
        "/poi/insight": 60,
        "/deep_analysis": 60,
    }
    ttl = cache_ttl_by_path.get(request.url.path)
    etag = None
    if request.method == "GET" and ttl:
        cache_params = tuple(
            sorted(
                (key, value)
                for key, value in request.query_params.multi_items()
                if key != "_v"
            )
        )
        raw_etag = repr((get_response_cache_token(), request.url.path, cache_params)).encode("utf-8")
        etag = f'W/"{hashlib.sha256(raw_etag).hexdigest()[:24]}"'
        if request.headers.get("if-none-match") == etag:
            return Response(
                status_code=304,
                headers={
                    "ETag": etag,
                    "Cache-Control": f"private, max-age={ttl}",
                    "Vary": "Accept-Encoding",
                },
            )

    response = await call_next(request)
    if request.method == "GET" and ttl and response.status_code == 200:
        response.headers.setdefault("Cache-Control", f"private, max-age={ttl}")
        response.headers.setdefault("Vary", "Accept-Encoding")
        if etag:
            response.headers.setdefault("ETag", etag)
    return response

app.include_router(upload_router)
app.include_router(query_router)
app.include_router(compare_router)
app.include_router(review_router)
app.include_router(plans_router)
app.include_router(deep_analysis_router)


__all__ = [
    "app",
    "ApproveOrderRequest",
    "COL_MAP",
    "COMPARE_METRIC_FIELDS",
    "COMPARE_TOTAL_DEPENDENCIES",
    "DAILY_PRODUCT_SUMMARY_FIELDS",
    "NON_ADDITIVE_AVERAGE_FIELDS",
    "PRODUCT_INDEX",
    "TOTAL_RATE_FIELDS",
    "TREND_AVERAGE_FIELDS",
    "ProductDateIndex",
    "UpdateProfitRequest",
    "_run_migrations",
    "apply_product_filter",
    "approve_order",
    "build_order_product_id",
    "clear_runtime_caches",
    "compute_display_metric_value",
    "compute_total_rate",
    "create_plan",
    "delete_commodity_data",
    "delete_data",
    "delete_data_batch",
    "delete_order_data",
    "delete_pending_order",
    "delete_plan",
    "ensure_daily_product_summaries",
    "ensure_daily_summaries",
    "get_compare_aggregate",
    "get_compare_report",
    "get_compare_trend",
    "get_poi_insight",
    "get_data",
    "get_deep_analysis",
    "get_date_status",
    "get_dates",
    "get_db",
    "get_poi_options",
    "get_pois",
    "get_pending_orders",
    "get_plans",
    "get_product_ids_for_pois",
    "get_products",
    "get_summary",
    "has_non_profit_data",
    "normalize_float_cell",
    "normalize_string_cell",
    "parse_compare_metrics",
    "parse_poi_names",
    "parse_product_ids",
    "refresh_daily_product_summary",
    "refresh_daily_summary",
    "refresh_materialized_summaries",
    "safe_divide",
    "update_pending_order",
    "update_plan",
    "upload_batch",
    "upload_file",
    "upload_orders",
]


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)

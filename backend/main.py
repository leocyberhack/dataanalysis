import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import models
from database import engine
from deps import get_db
from routes_compare import (
    get_compare_aggregate,
    get_compare_trend,
    router as compare_router,
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
from routes_upload import (
    delete_commodity_data,
    delete_data,
    delete_order_data,
    router as upload_router,
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(upload_router)
app.include_router(query_router)
app.include_router(compare_router)
app.include_router(review_router)


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
    "delete_commodity_data",
    "delete_data",
    "delete_order_data",
    "delete_pending_order",
    "ensure_daily_product_summaries",
    "ensure_daily_summaries",
    "get_compare_aggregate",
    "get_compare_trend",
    "get_data",
    "get_date_status",
    "get_dates",
    "get_db",
    "get_poi_options",
    "get_pois",
    "get_pending_orders",
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
    "upload_file",
    "upload_orders",
]


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)

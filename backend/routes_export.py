import csv
import io
import json
import sqlite3
import tempfile
import zipfile
from datetime import date, datetime
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

import models
from database import DATA_DIR
from deps import get_db
from services import get_poi_config_path


router = APIRouter()

EXPORT_TABLES = [
    ("products", models.Product),
    ("product_poi_map", models.ProductPoiMap),
    ("product_reviews", models.ProductReview),
    ("daily_data", models.DailyData),
    ("pending_orders", models.PendingOrder),
    ("plans", models.Plan),
    ("daily_summaries", models.DailySummary),
    ("daily_product_summaries", models.DailyProductSummary),
]


def serialize_cell(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is None:
        return ""
    return value


def write_model_csv(zip_file, db, export_name, model):
    columns = [column.name for column in model.__table__.columns]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns)
    writer.writeheader()

    row_count = 0
    for row in db.query(model).all():
        writer.writerow({
            column_name: serialize_cell(getattr(row, column_name))
            for column_name in columns
        })
        row_count += 1

    zip_file.writestr(
        f"csv/{export_name}.csv",
        output.getvalue().encode("utf-8-sig"),
    )
    return row_count


def write_sqlite_backup(zip_file):
    db_path = Path(DATA_DIR) / "data.db"
    if not db_path.exists():
        return None

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as temp_file:
        temp_path = Path(temp_file.name)

    source = None
    target = None
    try:
        source = sqlite3.connect(str(db_path))
        target = sqlite3.connect(str(temp_path))
        source.backup(target)
        target.close()
        source.close()
        target = None
        source = None
        zip_file.write(temp_path, "database/data.db")
        return temp_path.stat().st_size
    finally:
        if target is not None:
            target.close()
        if source is not None:
            source.close()
        temp_path.unlink(missing_ok=True)


def write_file_if_exists(zip_file, source_path, archive_path):
    source = Path(source_path)
    if source.exists() and source.is_file():
        zip_file.write(source, archive_path)
        return True
    return False


def write_uploaded_file_archive(zip_file):
    upload_root = Path(DATA_DIR) / "uploaded_files"
    if not upload_root.exists():
        return 0

    file_count = 0
    for source in sorted(upload_root.rglob("*")):
        if not source.is_file():
            continue
        relative_path = source.relative_to(upload_root).as_posix()
        zip_file.write(source, f"uploaded_files/{relative_path}")
        file_count += 1
    return file_count


@router.get("/data/export/all")
def download_all_cloud_data(db: Session = Depends(get_db)):
    generated_at = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    zip_buffer = io.BytesIO()
    metadata = {
        "generated_at": generated_at,
        "database_backup_bytes": None,
        "csv_row_counts": {},
        "uploaded_file_count": 0,
        "included_config_files": [],
    }

    with zipfile.ZipFile(zip_buffer, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        metadata["database_backup_bytes"] = write_sqlite_backup(zip_file)

        for export_name, model in EXPORT_TABLES:
            metadata["csv_row_counts"][export_name] = write_model_csv(zip_file, db, export_name, model)

        metadata["uploaded_file_count"] = write_uploaded_file_archive(zip_file)

        poi_config_path = get_poi_config_path()
        if write_file_if_exists(zip_file, poi_config_path, "config/POI.json"):
            metadata["included_config_files"].append("config/POI.json")

        zip_file.writestr(
            "metadata.json",
            json.dumps(metadata, ensure_ascii=False, indent=2).encode("utf-8"),
        )

    zip_buffer.seek(0)
    filename = f"zeabur_cloud_data_{generated_at}.zip"
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )

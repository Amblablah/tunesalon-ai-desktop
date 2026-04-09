import json
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException

from api.config import get_config
from api.schemas.settings import AppSettings, SettingsUpdate
from api.schemas.library import DiskUsage
from api.routers.library import _dir_size_bytes

router = APIRouter()


def _settings_path() -> Path:
    cfg = get_config()
    return Path(cfg["paths"]["settings_file"])


def _read_settings() -> AppSettings:
    """Read settings from disk, or return defaults."""
    path = _settings_path()
    if path.exists():
        try:
            data = json.loads(path.read_text())
            return AppSettings(**data)
        except Exception:
            pass
    return AppSettings()


def _write_settings(settings: AppSettings):
    """Write settings to disk."""
    path = _settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings.model_dump(), indent=2))


@router.get("", response_model=AppSettings)
async def get_settings():
    """Read current settings (or defaults if none saved)."""
    return _read_settings()


@router.put("", response_model=AppSettings)
async def set_settings(settings: AppSettings):
    """Replace all settings."""
    _write_settings(settings)
    return settings


@router.patch("", response_model=AppSettings)
async def update_settings(update: SettingsUpdate):
    """Partial update — only provided fields are changed."""
    current = _read_settings()
    update_data = update.model_dump(exclude_none=True)
    merged = current.model_dump()
    merged.update(update_data)
    updated = AppSettings(**merged)
    _write_settings(updated)
    return updated


@router.get("/storage", response_model=DiskUsage)
async def get_storage_usage():
    """Disk usage per storage directory."""
    cfg = get_config()
    paths = cfg["paths"]

    # Clean up stale _merged_temp from failed GGUF exports
    gguf_dir = Path(paths["gguf_dir"])
    merged_temp = gguf_dir / "_merged_temp"
    if merged_temp.exists():
        shutil.rmtree(merged_temp, ignore_errors=True)

    models_bytes = _dir_size_bytes(Path(paths["models_dir"]))
    adapters_bytes = _dir_size_bytes(Path(paths["adapters_dir"]))
    gguf_bytes = _dir_size_bytes(gguf_dir)
    embeddings_bytes = _dir_size_bytes(Path(paths["embeddings_dir"]))
    total_bytes = models_bytes + adapters_bytes + gguf_bytes + embeddings_bytes

    return DiskUsage(
        models_gb=round(models_bytes / (1024 ** 3), 2),
        adapters_mb=round(adapters_bytes / (1024 ** 2), 2),
        gguf_gb=round(gguf_bytes / (1024 ** 3), 2),
        embeddings_gb=round(embeddings_bytes / (1024 ** 3), 2),
        total_gb=round(total_bytes / (1024 ** 3), 2),
    )


@router.put("/storage")
async def update_storage_paths(paths: dict):
    """Update storage path overrides in settings (does not move files)."""
    current = _read_settings()
    current.storage_paths = paths
    _write_settings(current)
    return {"storage_paths": paths, "note": "Paths updated. Restart app to apply. Files are not moved automatically."}

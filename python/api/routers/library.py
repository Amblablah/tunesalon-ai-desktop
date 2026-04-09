import os
import json
import shutil
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.config import get_config
from api.schemas.library import (
    DiskUsage, BaseModelEntry, AdapterEntry, GgufEntry
)

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _dir_size_bytes(path: Path) -> int:
    """Recursively compute total size of a directory in bytes."""
    if not path.exists():
        return 0
    total = 0
    for f in path.rglob("*"):
        if f.is_file():
            total += f.stat().st_size
    return total


def _file_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_dir():
        return _dir_size_bytes(path)
    return path.stat().st_size


def _iso_timestamp(path: Path) -> str:
    """Return ISO timestamp of file/dir creation (or modification as fallback)."""
    try:
        stat = path.stat()
        ts = stat.st_birthtime if hasattr(stat, "st_birthtime") else stat.st_mtime
    except Exception:
        ts = 0
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _safe_name(name: str) -> str:
    """Validate a name doesn't contain path traversal."""
    if ".." in name or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Invalid name")
    return name


def _read_adapter_metadata(adapter_path: Path) -> Optional[str]:
    """Try to read base_model from adapter_config.json inside an .adapter zip or dir."""
    config_path = None
    if adapter_path.is_dir():
        config_path = adapter_path / "adapter_config.json"
    elif adapter_path.suffix == ".adapter":
        # .adapter files are zip archives — try to peek inside
        import zipfile
        try:
            with zipfile.ZipFile(adapter_path, "r") as zf:
                for name in zf.namelist():
                    if name.endswith("adapter_config.json"):
                        data = json.loads(zf.read(name))
                        return data.get("base_model_name_or_path")
        except Exception:
            pass
        return None

    if config_path and config_path.exists():
        try:
            data = json.loads(config_path.read_text())
            return data.get("base_model_name_or_path")
        except Exception:
            pass
    return None


def _guess_quantization(filename: str) -> Optional[str]:
    """Extract quantization level from GGUF filename (e.g. 'model-Q4_K_M.gguf' → 'Q4_K_M')."""
    match = re.search(r"(Q\d+[_A-Z0-9]*)", filename, re.IGNORECASE)
    return match.group(1) if match else None


def _guess_parameters(model_path: Path) -> Optional[str]:
    """Try to read parameter count from config.json."""
    config_path = model_path / "config.json"
    if config_path.exists():
        try:
            data = json.loads(config_path.read_text())
            # Some configs have num_parameters or we can estimate from hidden_size
            if "num_parameters" in data:
                params = data["num_parameters"]
                if params > 1e9:
                    return f"{params / 1e9:.1f}B"
                return f"{params / 1e6:.0f}M"
        except Exception:
            pass
    return None


def _is_model_complete(model_path: Path) -> bool:
    """Check if a downloaded model directory is complete (has config.json at minimum).

    HuggingFace snapshot_download creates the directory before downloading files,
    so we need to verify the download actually finished by checking for essential files.
    """
    if not model_path.is_dir():
        return False
    # For HF cache layout, check inside snapshots/
    snapshots_dir = model_path / "snapshots"
    if snapshots_dir.exists():
        # Check any snapshot subdirectory for config.json
        for snap in snapshots_dir.iterdir():
            if snap.is_dir() and (snap / "config.json").exists():
                return True
        return False
    # For direct layout, check for config.json directly
    return (model_path / "config.json").exists()


# ── Disk Usage ───────────────────────────────────────────────────────────────

@router.get("/disk-usage", response_model=DiskUsage)
async def get_disk_usage():
    """Scan all storage directories and return disk usage summary."""
    cfg = get_config()
    paths = cfg["paths"]

    models_bytes = _dir_size_bytes(Path(paths["models_dir"]))
    adapters_bytes = _dir_size_bytes(Path(paths["adapters_dir"]))
    gguf_bytes = _dir_size_bytes(Path(paths["gguf_dir"]))
    embeddings_bytes = _dir_size_bytes(Path(paths["embeddings_dir"]))
    total_bytes = models_bytes + adapters_bytes + gguf_bytes + embeddings_bytes

    return DiskUsage(
        models_gb=round(models_bytes / (1024 ** 3), 2),
        adapters_mb=round(adapters_bytes / (1024 ** 2), 2),
        gguf_gb=round(gguf_bytes / (1024 ** 3), 2),
        embeddings_gb=round(embeddings_bytes / (1024 ** 3), 2),
        total_gb=round(total_bytes / (1024 ** 3), 2),
    )


# ── Base Models ──────────────────────────────────────────────────────────────

@router.get("/models", response_model=list[BaseModelEntry])
async def list_models():
    """List downloaded base models. Models are stored as subdirectories (org/name)."""
    cfg = get_config()
    models_dir = Path(cfg["paths"]["models_dir"])
    entries = []

    if not models_dir.exists():
        return entries

    # HuggingFace models are stored as models_dir/models--org--name/snapshots/...
    # or as models_dir/org/name/ (simpler layout)
    # Check for HF cache layout first
    for item in sorted(models_dir.iterdir()):
        if not item.is_dir():
            continue

        if item.name.startswith("models--"):
            # HF cache layout: models--org--name
            if not _is_model_complete(item):
                continue  # skip incomplete downloads
            parts = item.name.replace("models--", "").split("--", 1)
            model_name = "/".join(parts) if len(parts) == 2 else item.name
        elif "--" in item.name and not item.name.startswith("."):
            # snapshot_download layout: org--name (e.g. microsoft--Phi-4-mini-instruct)
            if not _is_model_complete(item):
                continue  # skip incomplete downloads
            parts = item.name.split("--", 1)
            model_name = "/".join(parts) if len(parts) == 2 else item.name
        elif item.name.startswith("."):
            continue  # skip hidden dirs
        else:
            # Check for org/name structure
            subdirs = [d for d in item.iterdir() if d.is_dir() and not d.name.startswith(".")]
            if subdirs:
                # org/name layout
                for sub in subdirs:
                    if not _is_model_complete(sub):
                        continue  # skip incomplete downloads
                    model_name = f"{item.name}/{sub.name}"
                    size_bytes = _dir_size_bytes(sub)
                    entries.append(BaseModelEntry(
                        name=model_name,
                        path=str(sub),
                        size_gb=round(size_bytes / (1024 ** 3), 2),
                        parameters=_guess_parameters(sub),
                        downloaded_at=_iso_timestamp(sub),
                    ))
                continue
            else:
                if not _is_model_complete(item):
                    continue  # skip incomplete downloads
                model_name = item.name

        size_bytes = _dir_size_bytes(item)
        entries.append(BaseModelEntry(
            name=model_name,
            path=str(item),
            size_gb=round(size_bytes / (1024 ** 3), 2),
            parameters=_guess_parameters(item),
            downloaded_at=_iso_timestamp(item),
        ))

    return entries


@router.delete("/models/{model_name:path}")
async def delete_model(model_name: str):
    """Delete a downloaded base model from disk."""
    cfg = get_config()
    models_dir = Path(cfg["paths"]["models_dir"])

    # Try org/name layout first
    model_path = models_dir / model_name
    if not model_path.exists():
        # Try snapshot_download layout: org--name
        safe_name = model_name.replace("/", "--")
        model_path = models_dir / safe_name
    if not model_path.exists():
        # Try HF cache layout: models--org--name
        cache_name = "models--" + model_name.replace("/", "--")
        model_path = models_dir / cache_name

    if not model_path.exists():
        raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found")

    # Safety: ensure path is inside models_dir
    if not str(model_path.resolve()).startswith(str(models_dir.resolve())):
        raise HTTPException(status_code=400, detail="Invalid model path")

    size_gb = round(_dir_size_bytes(model_path) / (1024 ** 3), 2)
    shutil.rmtree(model_path)

    # Clean up empty parent org directory (e.g. models/microsoft/ after deleting microsoft/Phi-4)
    parent = model_path.parent
    if parent != models_dir and parent.exists() and not any(parent.iterdir()):
        parent.rmdir()

    return {"deleted": model_name, "freed_gb": size_gb}


# ── Adapters ─────────────────────────────────────────────────────────────────

@router.get("/adapters", response_model=list[AdapterEntry])
async def list_adapters():
    """List .adapter files in the adapters directory."""
    cfg = get_config()
    adapters_dir = Path(cfg["paths"]["adapters_dir"])
    entries = []

    if not adapters_dir.exists():
        return entries

    for item in sorted(adapters_dir.iterdir()):
        if item.name.startswith("."):
            continue
        # Accept both .adapter files and adapter directories
        if item.suffix == ".adapter" or (item.is_dir() and (item / "adapter_config.json").exists()):
            size_bytes = _file_size_bytes(item)
            entries.append(AdapterEntry(
                name=item.name,
                path=str(item),
                size_mb=round(size_bytes / (1024 ** 2), 2),
                base_model=_read_adapter_metadata(item),
                created_at=_iso_timestamp(item),
            ))

    return entries


@router.post("/adapters/import")
async def import_adapter(source_path: str):
    """Import an .adapter file by copying it from a user-selected path."""
    src = Path(source_path)
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {source_path}")
    if src.suffix != ".adapter":
        raise HTTPException(status_code=400, detail="Only .adapter files can be imported")

    cfg = get_config()
    adapters_dir = Path(cfg["paths"]["adapters_dir"])
    dest = adapters_dir / src.name

    if dest.exists():
        raise HTTPException(status_code=409, detail=f"Adapter '{src.name}' already exists")

    shutil.copy2(str(src), str(dest))
    size_mb = round(dest.stat().st_size / (1024 ** 2), 2)
    return {"imported": src.name, "size_mb": size_mb, "path": str(dest)}


@router.delete("/adapters/{name}")
async def delete_adapter(name: str):
    """Delete an adapter file from disk."""
    name = _safe_name(name)
    cfg = get_config()
    adapters_dir = Path(cfg["paths"]["adapters_dir"])
    adapter_path = adapters_dir / name

    if not adapter_path.exists():
        raise HTTPException(status_code=404, detail=f"Adapter '{name}' not found")

    size_mb = round(_file_size_bytes(adapter_path) / (1024 ** 2), 2)

    if adapter_path.is_dir():
        shutil.rmtree(adapter_path)
    else:
        adapter_path.unlink()

    return {"deleted": name, "freed_mb": size_mb}


class RenameRequest(BaseModel):
    new_name: str


@router.patch("/adapters/{name}")
async def rename_adapter(name: str, req: RenameRequest):
    """Rename an adapter file."""
    name = _safe_name(name)
    new_name = _safe_name(req.new_name)

    cfg = get_config()
    adapters_dir = Path(cfg["paths"]["adapters_dir"])
    old_path = adapters_dir / name
    new_path = adapters_dir / new_name

    if not old_path.exists():
        raise HTTPException(status_code=404, detail=f"Adapter '{name}' not found")
    if new_path.exists():
        raise HTTPException(status_code=409, detail=f"Adapter '{new_name}' already exists")

    # Ensure new name keeps .adapter extension if original had it
    if old_path.suffix == ".adapter" and not new_name.endswith(".adapter"):
        new_name = new_name + ".adapter"
        new_path = adapters_dir / new_name

    old_path.rename(new_path)

    # Return full AdapterEntry so frontend can update the list
    size_bytes = _file_size_bytes(new_path)
    return AdapterEntry(
        name=new_name,
        path=str(new_path),
        size_mb=round(size_bytes / (1024 ** 2), 2),
        base_model=_read_adapter_metadata(new_path),
        created_at=_iso_timestamp(new_path),
    )


# ── GGUF Files ───────────────────────────────────────────────────────────────

@router.get("/gguf", response_model=list[GgufEntry])
async def list_gguf():
    """List .gguf files in the GGUF directory."""
    cfg = get_config()
    gguf_dir = Path(cfg["paths"]["gguf_dir"])
    entries = []

    if not gguf_dir.exists():
        return entries

    for item in sorted(gguf_dir.iterdir()):
        if item.suffix == ".gguf" and item.is_file():
            size_bytes = item.stat().st_size
            entries.append(GgufEntry(
                name=item.name,
                path=str(item),
                size_gb=round(size_bytes / (1024 ** 3), 2),
                quantization=_guess_quantization(item.name),
                created_at=_iso_timestamp(item),
            ))

    return entries


@router.post("/gguf/import")
async def import_gguf(source_path: str):
    """Import a .gguf file by copying it from a user-selected path."""
    src = Path(source_path)
    if not src.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {source_path}")
    if src.suffix != ".gguf":
        raise HTTPException(status_code=400, detail="Only .gguf files can be imported")

    cfg = get_config()
    gguf_dir = Path(cfg["paths"]["gguf_dir"])
    dest = gguf_dir / src.name

    if dest.exists():
        raise HTTPException(status_code=409, detail=f"GGUF file '{src.name}' already exists")

    shutil.copy2(str(src), str(dest))
    size_gb = round(dest.stat().st_size / (1024 ** 3), 2)
    return {"imported": src.name, "size_gb": size_gb, "path": str(dest)}


@router.delete("/gguf/{name}")
async def delete_gguf(name: str):
    """Delete a GGUF file from disk."""
    name = _safe_name(name)
    cfg = get_config()
    gguf_dir = Path(cfg["paths"]["gguf_dir"])
    gguf_path = gguf_dir / name

    if not gguf_path.exists():
        raise HTTPException(status_code=404, detail=f"GGUF file '{name}' not found")

    size_gb = round(gguf_path.stat().st_size / (1024 ** 3), 2)
    gguf_path.unlink()
    return {"deleted": name, "freed_gb": size_gb}

"""Train router — local model download, training, adapter save, GGUF export."""

import json
import logging
import shutil
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from api.config import get_config, get_app_data_dir, get_supported_models
from api.schemas.train import (
    ModelSearchResult, TrainRequest, TrainProgressEvent,
    SaveAdapterRequest, GgufExportRequest, ModelDownloadRequest,
    ModelDownloadStatus,
)
from api.services.huggingface import search_models, download_model

logger = logging.getLogger(__name__)
router = APIRouter()

# --- Persistent training result (survives backend restarts) ---

_RESULT_FILE = get_app_data_dir() / "last_training_result.json"


def _save_result_to_disk():
    """Persist the training result so it survives restarts."""
    data = {
        "status": _train_state["status"],
        "message": _train_state["message"],
        "step": _train_state["step"],
        "total_steps": _train_state["total_steps"],
        "loss": _train_state["loss"],
        "epoch": _train_state["epoch"],
        "adapter_path": _train_state["adapter_path"],
        "base_model": _train_state["base_model"],
        "system_prompt": _train_state.get("system_prompt"),
    }
    try:
        _RESULT_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to save training result: {e}")


def _load_result_from_disk():
    """Restore training result on startup (if exists)."""
    if not _RESULT_FILE.exists():
        return
    try:
        data = json.loads(_RESULT_FILE.read_text(encoding="utf-8"))
        # Only restore completed/error results — active states can't resume
        if data.get("status") in ("complete", "error"):
            for key in ("status", "message", "step", "total_steps",
                        "loss", "epoch", "adapter_path", "base_model",
                        "system_prompt"):
                if key in data:
                    _train_state[key] = data[key]
            logger.info(f"Restored training result from disk: {data['status']}")
    except Exception as e:
        logger.warning(f"Failed to load training result: {e}")


def _clear_result_from_disk():
    """Remove persisted result (user clicked 'Train Another Model')."""
    try:
        if _RESULT_FILE.exists():
            _RESULT_FILE.unlink()
    except Exception as e:
        logger.warning(f"Failed to clear training result: {e}")


# --- Shared state for background operations ---

_download_state = {
    "status": "idle",  # idle, downloading, complete, error, cancelled
    "model_id": None,
    "progress": 0.0,
    "message": "",
    "cancel_flag": False,
    "thread": None,
}

_train_state = {
    "status": "idle",  # idle, preparing, training, saving, complete, error, cancelled
    "message": "",
    "step": None,
    "total_steps": None,
    "loss": None,
    "epoch": None,
    "cancel_flag": False,
    "thread": None,
    "adapter_path": None,
    "base_model": None,
    "system_prompt": None,
}

_gguf_state = {
    "status": "idle",  # idle, exporting, complete, error
    "message": "",
    "output_path": None,
}

# Restore last training result on startup
_load_result_from_disk()


# ========================
# MODEL SEARCH / CURATED
# ========================

@router.get("/models/search", response_model=list[ModelSearchResult])
async def search_hf_models(q: str = "", limit: int = 20):
    """Search HuggingFace for models + include curated list."""
    results = search_models(query=q, limit=limit)
    return [ModelSearchResult(**r) for r in results]


@router.get("/models/curated", response_model=list[ModelSearchResult])
async def get_curated_models():
    """Return just the curated model list from config."""
    curated = get_supported_models()
    return [
        ModelSearchResult(
            model_id=m["name"],
            description=m.get("description", ""),
            is_curated=True,
            vram_training_gb=m.get("vram_training_gb"),
            vram_inference_gb=m.get("vram_inference_gb"),
            license=m.get("license"),
            gated=m.get("gated", False),
        )
        for m in curated
    ]


# ========================
# MODEL DOWNLOAD
# ========================

@router.get("/models/check")
async def check_model_downloaded(model_id: str):
    """Check if a model is already downloaded locally."""
    config = get_config()
    models_dir = config["paths"]["models_dir"]
    safe_name = model_id.replace("/", "--")
    model_path = Path(models_dir) / safe_name
    downloaded = model_path.exists() and (model_path / "config.json").exists()
    return {"downloaded": downloaded, "model_id": model_id}


def _cleanup_partial_download(model_id: str, models_dir: str):
    """Remove partially downloaded model directory."""
    safe_name = model_id.replace("/", "--")
    model_path = Path(models_dir) / safe_name
    if model_path.exists():
        # Only remove if download is incomplete (no config.json)
        config_exists = (model_path / "config.json").exists()
        # Also check HF cache snapshots layout
        snapshots_dir = model_path / "snapshots"
        if snapshots_dir.exists():
            config_exists = any(
                (snap / "config.json").exists()
                for snap in snapshots_dir.iterdir()
                if snap.is_dir()
            )
        if not config_exists:
            logger.info(f"Cleaning up partial download: {model_path}")
            shutil.rmtree(model_path, ignore_errors=True)


def _download_worker(model_id: str, models_dir: str):
    """Background thread: download model from HF."""
    try:
        def progress_cb(pct: float, msg: str):
            if _download_state["cancel_flag"]:
                raise InterruptedError("Download cancelled by user")
            _download_state["progress"] = pct
            _download_state["message"] = msg

        _download_state["status"] = "downloading"
        _download_state["model_id"] = model_id
        _download_state["progress"] = 0.0
        _download_state["message"] = f"Downloading {model_id}..."

        download_model(model_id, models_dir, progress_callback=progress_cb)

        if _download_state["cancel_flag"]:
            _download_state["status"] = "cancelled"
            _download_state["message"] = "Download cancelled"
            _cleanup_partial_download(model_id, models_dir)
        else:
            _download_state["status"] = "complete"
            _download_state["progress"] = 100.0
            _download_state["message"] = f"Download complete: {model_id}"

    except InterruptedError:
        _download_state["status"] = "cancelled"
        _download_state["message"] = "Download cancelled"
        _cleanup_partial_download(model_id, models_dir)
    except Exception as e:
        _download_state["status"] = "error"
        _download_state["message"] = f"Download failed: {str(e)}"
        logger.error(f"Model download error: {e}", exc_info=True)
        _cleanup_partial_download(model_id, models_dir)


@router.post("/models/download")
async def start_model_download(req: ModelDownloadRequest):
    """Start downloading a model from HuggingFace (runs in background)."""
    config = get_config()
    models_dir = config["paths"]["models_dir"]

    # Check if already downloaded FIRST (before any thread checks)
    safe_name = req.model_id.replace("/", "--")
    model_path = Path(models_dir) / safe_name
    if model_path.exists() and (model_path / "config.json").exists():
        _download_state["status"] = "complete"
        _download_state["model_id"] = req.model_id
        _download_state["progress"] = 100.0
        _download_state["message"] = "Model already downloaded"
        return {"status": "complete", "message": "Model already downloaded", "path": str(model_path)}

    # Check if a download thread for a DIFFERENT model is still running
    thread = _download_state.get("thread")
    if thread and thread.is_alive():
        # Cancel the old download so we can start the new one
        _download_state["cancel_flag"] = True
        thread.join(timeout=5)  # Wait up to 5s for it to stop
        if thread.is_alive():
            raise HTTPException(400, "Another download is still running. Please try again in a moment.")

    # Reset state and start download thread
    _download_state["cancel_flag"] = False
    _download_state["status"] = "downloading"
    _download_state["model_id"] = req.model_id
    _download_state["progress"] = 0.0

    thread = threading.Thread(
        target=_download_worker,
        args=(req.model_id, models_dir),
        daemon=True,
    )
    _download_state["thread"] = thread
    thread.start()

    return {"status": "downloading", "message": f"Download started: {req.model_id}"}


@router.get("/models/download/status", response_model=ModelDownloadStatus)
async def get_download_status():
    """Check model download progress."""
    return ModelDownloadStatus(
        status=_download_state["status"],
        model_id=_download_state["model_id"],
        progress=_download_state["progress"],
        message=_download_state["message"],
    )


@router.get("/models/download/stream")
async def stream_download_progress():
    """SSE stream of download progress. Polls internal state every 0.5s."""
    import asyncio

    async def event_stream():
        while True:
            data = ModelDownloadStatus(
                status=_download_state["status"],
                model_id=_download_state["model_id"],
                progress=_download_state["progress"],
                message=_download_state["message"],
            )
            yield f"data: {data.model_dump_json()}\n\n"

            if _download_state["status"] in ("complete", "error", "cancelled", "idle"):
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.delete("/models/download")
async def cancel_download():
    """Cancel an in-progress model download."""
    if _download_state["status"] != "downloading":
        return {"status": _download_state["status"], "message": "No download in progress"}

    _download_state["cancel_flag"] = True
    return {"status": "cancelling", "message": "Download cancellation requested"}


# ========================
# DATASET UPLOAD / VALIDATE
# ========================

@router.post("/dataset/upload")
async def upload_dataset(file: UploadFile = File(...)):
    """Upload a JSONL dataset file. Matches website validation logic exactly."""
    fname = file.filename or "dataset.jsonl"
    if not fname.endswith(".jsonl"):
        raise HTTPException(400, "Only .jsonl files are accepted.")

    raw_bytes = await file.read()
    if len(raw_bytes) > 50 * 1024 * 1024:
        raise HTTPException(400, "File is too large (max 50 MB).")

    content = raw_bytes.decode("utf-8", errors="replace")

    # Validate — matches website's _validate_jsonl_content() exactly
    lines = content.strip().split("\n")
    line_count = 0
    errors = []
    preview = []

    for i, line in enumerate(lines, 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            errors.append(f"Line {i}: invalid JSON")
            continue

        # Skip dataset metadata header (generated by Dataset Generator)
        if "_metadata" in obj:
            continue

        if "messages" not in obj:
            errors.append(
                f"Line {i}: missing 'messages' field. "
                "Each line needs a 'messages' array with role/content pairs."
            )
            continue

        line_count += 1
        # Build preview from first 3 examples
        if len(preview) < 3:
            msgs = obj["messages"]
            user_msg = next((m["content"] for m in msgs if m.get("role") == "user"), "")
            asst_msg = next((m["content"] for m in msgs if m.get("role") == "assistant"), "")
            preview.append({
                "instruction": user_msg[:200],
                "output": asst_msg[:200],
            })

    if errors and line_count == 0:
        return {
            "valid": False, "example_count": 0, "format": "unknown",
            "errors": errors[:10], "preview": [], "path": "",
        }

    # Strip _metadata lines before saving (matching website logic)
    clean_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        try:
            obj = json.loads(stripped)
            if "_metadata" in obj:
                continue
        except json.JSONDecodeError:
            pass
        clean_lines.append(stripped)

    # Save with clean content
    config = get_config()
    app_data = Path(config["paths"]["models_dir"]).parent
    datasets_dir = app_data / "datasets"
    datasets_dir.mkdir(parents=True, exist_ok=True)
    dest = datasets_dir / fname
    dest.write_text("\n".join(clean_lines) + "\n", encoding="utf-8")

    return {
        "valid": line_count > 0 and len(errors) == 0,
        "example_count": line_count,
        "format": "messages",
        "errors": errors[:10],
        "preview": preview,
        "path": str(dest),
    }


@router.post("/dataset/validate")
async def validate_dataset(file: UploadFile = File(...)):
    """Validate a JSONL dataset without saving it."""
    if not file.filename.endswith(".jsonl"):
        raise HTTPException(400, "Dataset must be a .jsonl file")

    content = await file.read()
    line_count = 0
    errors = []
    sample_messages = []

    for i, line in enumerate(content.decode("utf-8", errors="replace").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if "messages" not in obj:
                errors.append(f"Line {i}: missing 'messages' key")
            else:
                line_count += 1
                if len(sample_messages) < 3:
                    sample_messages.append(obj["messages"])
        except json.JSONDecodeError as e:
            errors.append(f"Line {i}: invalid JSON — {e}")

    return {
        "valid": len(errors) == 0,
        "examples": line_count,
        "errors": errors[:10],
        "sample_messages": sample_messages,
    }


# ========================
# TRAINING
# ========================

def _train_worker(
    model_name: str,
    dataset_path: str,
    output_dir: str,
    eval_dataset_path: Optional[str],
    config_overrides: dict,
):
    """Background thread: run training via core.trainer.train()."""
    try:
        _train_state["status"] = "preparing"
        _train_state["message"] = f"Preparing to train with {model_name}..."
        _train_state["base_model"] = model_name

        # Extract system prompt from first example in training data
        try:
            with open(dataset_path, "r", encoding="utf-8") as f:
                first_line = f.readline().strip()
            if first_line:
                example = json.loads(first_line)
                msgs = example.get("messages", [])
                if msgs and msgs[0].get("role") == "system":
                    _train_state["system_prompt"] = msgs[0]["content"]
        except Exception:
            pass  # Non-critical — adapter still works without it

        # Resolve model path: check if downloaded locally
        cfg = get_config()
        models_dir = cfg["paths"]["models_dir"]
        safe_name = model_name.replace("/", "--")
        local_model = Path(models_dir) / safe_name
        actual_model = str(local_model) if local_model.exists() else model_name

        def progress_cb(msg: str):
            if _train_state["cancel_flag"]:
                raise InterruptedError("Training cancelled by user")
            _train_state["message"] = msg
            # Parse step info from trainer callback messages
            if msg.startswith("Step "):
                try:
                    parts = msg.split("/")
                    step = int(parts[0].replace("Step ", ""))
                    rest = parts[1].split(" -")
                    total = int(rest[0].strip())
                    _train_state["step"] = step
                    _train_state["total_steps"] = total
                    _train_state["status"] = "training"
                    # Extract loss
                    for part in rest:
                        if "loss:" in part:
                            _train_state["loss"] = float(part.split("loss:")[1].strip())
                        if "epoch:" in part:
                            _train_state["epoch"] = float(part.split("epoch:")[1].strip())
                except (ValueError, IndexError):
                    pass
            elif "Loading" in msg or "Validating" in msg or "Configuring" in msg:
                _train_state["status"] = "preparing"
            elif "Starting training" in msg:
                _train_state["status"] = "training"
            elif "Training complete" in msg:
                _train_state["status"] = "saving"

        from core.trainer import train

        adapter_path = train(
            base_model=actual_model,
            dataset_path=dataset_path,
            output_dir=output_dir,
            eval_dataset_path=eval_dataset_path,
            config=config_overrides,
            progress_callback=progress_cb,
        )

        _train_state["status"] = "complete"
        _train_state["message"] = "Training complete!"
        _train_state["adapter_path"] = adapter_path
        _save_result_to_disk()

    except InterruptedError:
        _train_state["status"] = "cancelled"
        _train_state["message"] = "Training cancelled by user"
    except Exception as e:
        _train_state["status"] = "error"
        err_str = str(e)
        # Translate common errors to user-friendly messages
        if "out of memory" in err_str.lower() or "CUDA out of memory" in err_str:
            _train_state["message"] = (
                "Your GPU ran out of memory. Try a smaller model, "
                "or reduce the batch size and sequence length in Advanced Settings."
            )
        elif "MmBackward0" in err_str or "invalid gradient" in err_str:
            _train_state["message"] = (
                "This model is too large for your GPU's memory. "
                "Try a smaller model that fits your GPU."
            )
        else:
            _train_state["message"] = err_str
        logger.error(f"Training error: {e}", exc_info=True)
        _save_result_to_disk()


@router.post("/start")
async def start_training(req: TrainRequest):
    """Start training (runs in background thread)."""
    if _train_state["status"] in ("preparing", "training", "saving"):
        raise HTTPException(400, "Training is already in progress")

    config = get_config()

    # Training output goes to a temp directory — only moved to library when user saves
    app_data = Path(config["paths"]["models_dir"]).parent
    train_temp = app_data / "_training_temp"
    train_temp.mkdir(parents=True, exist_ok=True)
    adapter_name = req.adapter_name or f"adapter_{int(time.time())}"
    safe_adapter_name = adapter_name.replace(" ", "_").replace("/", "_")
    output_dir = str(train_temp / safe_adapter_name)

    # Build config overrides (only non-None values)
    overrides = {}
    for key in ["lora_r", "lora_alpha", "lora_dropout", "learning_rate",
                 "num_epochs", "batch_size", "gradient_accumulation_steps", "max_seq_length"]:
        val = getattr(req, key, None)
        if val is not None:
            overrides[key] = val

    # Reset state
    _train_state.update({
        "status": "preparing",
        "message": "Starting...",
        "step": None,
        "total_steps": None,
        "loss": None,
        "epoch": None,
        "cancel_flag": False,
        "adapter_path": None,
        "base_model": req.model_name,
        "system_prompt": None,
    })

    thread = threading.Thread(
        target=_train_worker,
        args=(req.model_name, req.dataset_path, output_dir, req.eval_dataset_path, overrides),
        daemon=True,
    )
    _train_state["thread"] = thread
    thread.start()

    return {"status": "started", "message": f"Training started: {req.model_name}", "output_dir": output_dir}


@router.get("/status")
async def get_train_status():
    """SSE stream of training progress. Detects dead training threads."""
    async def event_stream():
        last_msg = ""
        while True:
            # Detect dead thread: status says active but thread has died
            thread = _train_state.get("thread")
            if (
                _train_state["status"] in ("preparing", "training", "saving")
                and thread is not None
                and not thread.is_alive()
            ):
                # Thread crashed without updating state — surface the error
                if _train_state["status"] != "error":
                    _train_state["status"] = "error"
                    _train_state["message"] = (
                        "Training stopped unexpectedly. This usually means "
                        "your GPU ran out of memory. Try a smaller model or "
                        "reduce sequence length and batch size in settings."
                    )

            event = TrainProgressEvent(
                status=_train_state["status"],
                message=_train_state["message"],
                step=_train_state["step"],
                total_steps=_train_state["total_steps"],
                loss=_train_state["loss"],
                epoch=_train_state["epoch"],
            )
            msg = event.model_dump_json()
            if msg != last_msg:
                yield f"data: {msg}\n\n"
                last_msg = msg

            if _train_state["status"] in ("complete", "error", "cancelled", "idle"):
                break

            await _async_sleep(1.0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


async def _async_sleep(seconds: float):
    import asyncio
    await asyncio.sleep(seconds)


@router.get("/result")
async def get_train_result():
    """Get current training result (non-SSE, includes base_model)."""
    # Detect dead thread on poll too (for page refresh recovery)
    thread = _train_state.get("thread")
    if (
        _train_state["status"] in ("preparing", "training", "saving")
        and thread is not None
        and not thread.is_alive()
    ):
        _train_state["status"] = "error"
        _train_state["message"] = (
            "Training stopped unexpectedly. This usually means "
            "your GPU ran out of memory. Try a smaller model or "
            "reduce sequence length and batch size in settings."
        )
    return {
        "status": _train_state["status"],
        "message": _train_state["message"],
        "step": _train_state["step"],
        "total_steps": _train_state["total_steps"],
        "loss": _train_state["loss"],
        "epoch": _train_state["epoch"],
        "base_model": _train_state["base_model"],
        "adapter_path": _train_state["adapter_path"],
    }


@router.post("/cancel")
async def cancel_training():
    """Cancel in-progress training."""
    if _train_state["status"] not in ("preparing", "training"):
        return {"status": _train_state["status"], "message": "No training in progress"}

    _train_state["cancel_flag"] = True
    return {"status": "cancelling", "message": "Training cancellation requested"}


@router.post("/reset")
async def reset_training():
    """Clear training result and persisted state (user clicked 'Train Another Model')."""
    # Clean up temp adapter directory if it exists
    old_adapter = _train_state.get("adapter_path")
    if old_adapter:
        old_path = Path(old_adapter)
        if old_path.exists() and "_training_temp" in str(old_path):
            shutil.rmtree(old_path, ignore_errors=True)

    _train_state.update({
        "status": "idle",
        "message": "",
        "step": None,
        "total_steps": None,
        "loss": None,
        "epoch": None,
        "cancel_flag": False,
        "thread": None,
        "adapter_path": None,
        "base_model": None,
        "system_prompt": None,
    })
    _clear_result_from_disk()
    return {"status": "ok", "message": "Training state cleared"}


# ========================
# SAVE PATHS
# ========================

@router.get("/save-paths")
async def get_save_paths():
    """Return default save directories for adapter and GGUF files."""
    config = get_config()
    return {
        "adapters_dir": config["paths"]["adapters_dir"],
        "gguf_dir": config["paths"]["gguf_dir"],
    }



# ========================
# SAVE ADAPTER
# ========================

@router.post("/save-adapter")
async def save_adapter(req: SaveAdapterRequest):
    """Package the trained adapter as a .adapter file."""
    if _train_state["adapter_path"] is None:
        raise HTTPException(400, "No trained adapter available. Train a model first.")

    adapter_dir = Path(_train_state["adapter_path"])
    if not adapter_dir.exists():
        raise HTTPException(404, f"Adapter directory not found: {adapter_dir}")

    config = get_config()
    if req.custom_path:
        save_dir = Path(req.custom_path)
    else:
        save_dir = Path(config["paths"]["adapters_dir"])
    save_dir.mkdir(parents=True, exist_ok=True)

    safe_name = req.adapter_name.replace(" ", "_").replace("/", "_")
    adapter_file = save_dir / f"{safe_name}.adapter"

    # Create .adapter zip package
    with zipfile.ZipFile(adapter_file, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in adapter_dir.rglob("*"):
            if file.is_file():
                arcname = file.relative_to(adapter_dir)
                zf.write(file, arcname)

        # Add metadata
        metadata = {
            "adapter_name": req.adapter_name,
            "description": req.description or "",
            "base_model": req.base_model or _train_state.get("base_model", "unknown"),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        # Include the system prompt from training data so chat can auto-fill it
        sys_prompt = _train_state.get("system_prompt")
        if sys_prompt:
            metadata["system_prompt"] = sys_prompt
        zf.writestr("adapter_metadata.json", json.dumps(metadata, indent=2))

    size_mb = adapter_file.stat().st_size / (1024 * 1024)
    return {
        "status": "ok",
        "path": str(adapter_file),
        "size_mb": round(size_mb, 1),
        "adapter_name": req.adapter_name,
    }


# ========================
# GGUF EXPORT
# ========================

@router.post("/export-gguf")
def export_gguf_endpoint(req: GgufExportRequest):
    """Export GGUF: merge adapter into base model + convert. Blocks until done (like website)."""
    if _gguf_state["status"] == "exporting":
        raise HTTPException(400, "A GGUF export is already in progress")

    adapter_path = Path(req.adapter_path) if req.adapter_path else None
    if not adapter_path or not adapter_path.exists():
        # Fall back to the most recent training result's adapter path
        if _train_state.get("adapter_path"):
            adapter_path = Path(_train_state["adapter_path"])
        if not adapter_path or not adapter_path.exists():
            raise HTTPException(404, "Adapter not found. Please train a model first.")

    config = get_config()
    if req.custom_path:
        gguf_dir = Path(req.custom_path)
    else:
        gguf_dir = Path(config["paths"]["gguf_dir"])
    gguf_dir.mkdir(parents=True, exist_ok=True)

    # Resolve base model to local path (same logic as _train_worker)
    models_dir = config["paths"]["models_dir"]
    safe_name = req.base_model.replace("/", "--")
    local_model = Path(models_dir) / safe_name
    actual_model = str(local_model) if local_model.exists() else req.base_model

    output_name = req.output_name or f"model_{int(time.time())}"
    output_path = str(gguf_dir / f"{output_name}.gguf")

    quantization = req.quantization or "Q4_K_M"

    _gguf_state.update({
        "status": "exporting",
        "message": "Starting...",
        "output_path": None,
    })

    try:
        from core.exporter import merge_and_export_gguf

        result_path = merge_and_export_gguf(
            base_model=actual_model,
            adapter_path=str(adapter_path),
            output_path=output_path,
            quantization=quantization,
            progress_callback=lambda msg: _gguf_state.update({"message": msg}),
        )

        output_file = Path(result_path)
        size_mb = output_file.stat().st_size / (1024 * 1024)

        _gguf_state.update({
            "status": "complete",
            "message": "GGUF exported successfully",
            "output_path": result_path,
        })

        return {
            "status": "complete",
            "path": result_path,
            "size_mb": round(size_mb, 1),
            "quantization": quantization,
        }

    except Exception as e:
        _gguf_state.update({
            "status": "error",
            "message": f"GGUF export failed: {str(e)}",
        })
        logger.error(f"GGUF export error: {e}", exc_info=True)
        raise HTTPException(500, f"GGUF export failed: {str(e)}")

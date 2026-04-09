"""HuggingFace API integration for TuneSalon Desktop — model search + download."""

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Callable

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 3600  # 1 hour


@dataclass
class CachedModelInfo:
    downloads: Optional[int]
    last_modified: Optional[str]
    parameter_count: Optional[str]
    fetched_at: float


@dataclass
class CachedSearch:
    results: list
    fetched_at: float


_cache: dict[str, CachedModelInfo] = {}
_search_cache: dict[str, CachedSearch] = {}


def _format_params(num_params: Optional[int]) -> Optional[str]:
    if num_params is None:
        return None
    if num_params >= 1e9:
        return f"{num_params / 1e9:.1f}B"
    if num_params >= 1e6:
        return f"{num_params / 1e6:.0f}M"
    return str(num_params)


def _extract_param_count(model_info) -> Optional[int]:
    try:
        if hasattr(model_info, "safetensors") and model_info.safetensors:
            params = model_info.safetensors.get("total", None)
            if params:
                return int(params)
    except Exception:
        pass
    return None


def fetch_model_metadata(model_id: str) -> CachedModelInfo:
    """Fetch metadata for a single model from HF API, with caching."""
    now = time.time()

    if model_id in _cache:
        cached = _cache[model_id]
        if now - cached.fetched_at < CACHE_TTL_SECONDS:
            return cached

    try:
        from huggingface_hub import HfApi
        api = HfApi()
        info = api.model_info(model_id)

        result = CachedModelInfo(
            downloads=getattr(info, "downloads", None),
            last_modified=info.last_modified.isoformat() if info.last_modified else None,
            parameter_count=_format_params(_extract_param_count(info)),
            fetched_at=now,
        )
        _cache[model_id] = result
        return result

    except Exception as e:
        logger.warning(f"Failed to fetch HF metadata for {model_id}: {e}")
        if model_id in _cache:
            return _cache[model_id]
        return CachedModelInfo(
            downloads=None, last_modified=None, parameter_count=None, fetched_at=now,
        )


def search_models(query: str = "", limit: int = 20) -> list[dict]:
    """Search models: curated list first, then HF API results."""
    from api.config import get_supported_models

    now = time.time()
    cache_key = f"{query}:{limit}"

    if cache_key in _search_cache:
        cached = _search_cache[cache_key]
        if now - cached.fetched_at < CACHE_TTL_SECONDS:
            return cached.results

    curated_models = get_supported_models()
    curated_results = []
    curated_ids = set()

    for m in curated_models:
        model_id = m["name"]
        curated_ids.add(model_id)
        if query and query.lower() not in model_id.lower() and query.lower() not in m.get("description", "").lower():
            continue
        meta = fetch_model_metadata(model_id)
        curated_results.append({
            "model_id": model_id,
            "description": m.get("description", ""),
            "downloads": meta.downloads,
            "parameter_count": meta.parameter_count,
            "last_modified": meta.last_modified,
            "is_curated": True,
            "vram_training_gb": m.get("vram_training_gb"),
            "vram_inference_gb": m.get("vram_inference_gb"),
            "license": m.get("license"),
            "gated": m.get("gated", False),
        })

    hf_results = []
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        models = api.list_models(
            task="text-generation",
            sort="trending",
            library="transformers",
            search=query if query else None,
            limit=limit,
        )
        for info in models:
            mid = info.id
            if mid in curated_ids:
                continue
            param_count = _extract_param_count(info)
            hf_results.append({
                "model_id": mid,
                "description": getattr(info, "pipeline_tag", "") or "",
                "downloads": getattr(info, "downloads", None),
                "parameter_count": _format_params(param_count),
                "last_modified": info.last_modified.isoformat() if info.last_modified else None,
                "is_curated": False,
                "vram_training_gb": None,
                "vram_inference_gb": None,
                "license": None,
                "gated": getattr(info, "gated", False) if hasattr(info, "gated") else False,
            })
    except Exception as e:
        logger.warning(f"HF API search failed (returning curated only): {e}")

    results = curated_results + hf_results
    _search_cache[cache_key] = CachedSearch(results=results, fetched_at=now)
    return results


def _make_progress_tqdm(progress_callback, model_id):
    """Create a custom tqdm class that reports download progress via callback."""
    from tqdm import tqdm

    # Shared state between all tqdm instances (file-level and top-level)
    _state = {"files_done": 0, "files_total": 0}

    class ProgressTqdm(tqdm):
        """Custom tqdm that forwards file download progress to our callback."""
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._last_reported = -1.0
            self._is_file_bar = self.total and self.total > 100  # byte-level bars have large totals

            # Detect top-level "Fetching N files" bar
            if not self._is_file_bar and self.total and self.total > 0:
                _state["files_total"] = int(self.total)

        def update(self, n=1):
            super().update(n)
            if not self.total or self.total <= 0:
                return

            if self._is_file_bar:
                # Per-file byte-level progress
                pct = min(99.0, (self.n / self.total) * 100)
                # Calculate smooth overall percentage
                if _state["files_total"] > 0:
                    overall_pct = min(99.0, (_state["files_done"] / _state["files_total"]) * 100
                                      + pct / _state["files_total"])
                else:
                    overall_pct = pct
                # Report every 0.5% of overall progress (smooth updates)
                if overall_pct - self._last_reported >= 0.5:
                    self._last_reported = overall_pct
                    desc = self.desc or model_id
                    size_mb = self.total / (1024 * 1024)
                    done_mb = self.n / (1024 * 1024)
                    files_info = ""
                    if _state["files_total"] > 0:
                        files_info = f" (file {_state['files_done'] + 1}/{_state['files_total']})"
                    if size_mb > 1:
                        msg = f"Downloading {desc}{files_info} — {done_mb:.0f}/{size_mb:.0f} MB"
                    else:
                        msg = f"Downloading {desc}{files_info}"
                    progress_callback(overall_pct, msg)
            else:
                # Top-level file-count bar
                _state["files_done"] = int(self.n)
                pct = min(99.0, (self.n / self.total) * 100)
                if pct - self._last_reported >= 0.5:
                    self._last_reported = pct
                    msg = f"Fetching {int(self.total)} files ({int(self.n)}/{int(self.total)} complete)"
                    progress_callback(pct, msg)

    return ProgressTqdm


def download_model(
    model_id: str,
    target_dir: str,
    progress_callback: Optional[Callable[[float, str], None]] = None,
) -> str:
    """
    Download a model from HuggingFace to local disk.

    Args:
        model_id: HF model ID (e.g. "microsoft/Phi-4-mini-instruct")
        target_dir: Base directory for models (model saved in target_dir/model_name)
        progress_callback: Called with (percentage, message)

    Returns:
        Path to the downloaded model directory.
    """
    from huggingface_hub import snapshot_download

    # Create a safe directory name from model_id
    safe_name = model_id.replace("/", "--")
    model_dir = Path(target_dir) / safe_name

    if model_dir.exists() and (model_dir / "config.json").exists():
        if progress_callback:
            progress_callback(100.0, f"Model already downloaded at {model_dir}")
        return str(model_dir)

    if progress_callback:
        progress_callback(0.0, f"Starting download of {model_id}...")

    try:
        # Use custom tqdm to get real download progress
        tqdm_cls = _make_progress_tqdm(progress_callback, model_id) if progress_callback else None

        downloaded_path = snapshot_download(
            repo_id=model_id,
            local_dir=str(model_dir),
            tqdm_class=tqdm_cls,
        )
        if progress_callback:
            progress_callback(100.0, f"Download complete: {model_id}")
        return downloaded_path
    except Exception as e:
        if progress_callback:
            progress_callback(-1.0, f"Download failed: {str(e)}")
        raise


def get_model_info(model_id: str) -> dict:
    """Get detailed model info from HF API."""
    try:
        from huggingface_hub import HfApi
        api = HfApi()
        info = api.model_info(model_id)
        return {
            "model_id": model_id,
            "downloads": getattr(info, "downloads", None),
            "parameter_count": _format_params(_extract_param_count(info)),
            "last_modified": info.last_modified.isoformat() if info.last_modified else None,
            "pipeline_tag": getattr(info, "pipeline_tag", None),
            "library_name": getattr(info, "library_name", None),
            "gated": getattr(info, "gated", False) if hasattr(info, "gated") else False,
        }
    except Exception as e:
        logger.warning(f"Failed to get model info for {model_id}: {e}")
        return {"model_id": model_id, "error": str(e)}

"""Hardware detection & caching for TuneSalon Desktop (local only)."""

import json
import os
from pathlib import Path
from datetime import datetime

# Cache lives in %APPDATA%/TuneSalonDesktop/
_APPDATA = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
_APP_DIR = _APPDATA / "TuneSalonDesktop"
CACHE_FILE = _APP_DIR / ".env_cache.json"


def detect_environment() -> dict:
    """
    Detect everything about the current environment.
    Called once, result is cached. Do not call directly — use get_environment().
    Works even if torch is not installed (returns torch_missing=True in that case).
    """
    import platform
    import psutil

    env = {
        "detected_at": datetime.now().isoformat(),
        "python_version": platform.python_version(),
        "os": platform.system(),
        "os_version": platform.version(),
        "cpu": platform.processor(),
        "ram_gb": round(psutil.virtual_memory().total / 1e9, 1),
        "disk_free_gb": round(psutil.disk_usage("/").free / 1e9, 1),
    }

    try:
        import torch
        env["cuda_available"] = torch.cuda.is_available()
        env["torch_version"] = torch.__version__

        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            env["gpu"] = {
                "name": props.name,
                "vram_gb": round(props.total_memory / 1e9, 1),
                "compute_capability": [props.major, props.minor],
                "supports_bf16": props.major >= 8,
                "supports_flash_attention": props.major >= 8,
                "multi_gpu": torch.cuda.device_count() > 1,
                "device_count": torch.cuda.device_count(),
            }
            env["cuda_version"] = torch.version.cuda
        else:
            env["gpu"] = None
            env["cuda_version"] = None
    except ImportError:
        env["cuda_available"] = False
        env["torch_version"] = None
        env["gpu"] = None
        env["cuda_version"] = None
        env["torch_missing"] = True

    return env


def get_environment() -> dict:
    """
    Read from cache if it exists, otherwise detect and cache.
    This is the ONLY function other modules should call for hardware info.
    """
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text())

    env = detect_environment()
    _APP_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(env, indent=2))
    return env


def refresh_environment() -> dict:
    """
    Force re-detection. Use when:
    - Running on a new machine (cloud GPU)
    - User changed hardware
    - Cache seems wrong
    """
    if CACHE_FILE.exists():
        CACHE_FILE.unlink()
    return get_environment()

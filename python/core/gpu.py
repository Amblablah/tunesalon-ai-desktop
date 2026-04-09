"""Model recommendations based on detected hardware."""

import logging
from pathlib import Path

import yaml

from core.environment import get_environment

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).parent.parent / "desktop_config.yaml"


def _load_supported_models() -> list:
    """Load supported models list from desktop_config.yaml."""
    with open(CONFIG_PATH) as f:
        cfg = yaml.safe_load(f)
    return cfg.get("supported_models", [])


def recommend_models(for_training: bool = True) -> list:
    """
    Based on cached environment info and supported_models from desktop_config.yaml,
    return models with compatibility info.

    Args:
        for_training: If True, checks against vram_training_gb.
                      If False, checks against vram_inference_gb.

    Returns:
        List of dicts with model name, compatibility, and notes.
    """
    env = get_environment()
    gpu = env.get("gpu")
    supported = _load_supported_models()

    vram_key = "vram_training_gb" if for_training else "vram_inference_gb"
    vram_available = gpu["vram_gb"] if gpu else 0

    results = []
    for model in supported:
        vram_needed = model.get(vram_key)
        fits = False
        if gpu and vram_needed is not None:
            fits = vram_needed <= vram_available

        entry = {
            "model": model["name"],
            "fits_local": fits,
            "vram_needed_gb": vram_needed,
            "vram_available_gb": vram_available,
            "notes": model.get("notes", ""),
        }

        if not gpu:
            entry["notes"] += " [No GPU detected — CPU only]"
        elif not fits:
            entry["notes"] += f" [Needs {vram_needed}GB, only {vram_available}GB available]"

        results.append(entry)

    return results

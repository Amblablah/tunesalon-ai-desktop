"""System info router — local GPU detection + model compatibility."""

import platform
import shutil

import psutil
from fastapi import APIRouter

from api.schemas.system import GpuInfo, SystemInfo, ModelCompatibility
from api.config import get_supported_models
from core.environment import get_environment, refresh_environment
from core.gpu import recommend_models

router = APIRouter()


def _build_system_info(env: dict) -> SystemInfo:
    """Convert raw environment dict to SystemInfo response."""
    gpu_info = None
    if env.get("gpu"):
        gpu = env["gpu"]
        cc = gpu.get("compute_capability")
        cc_str = f"{cc[0]}.{cc[1]}" if cc else None
        gpu_info = GpuInfo(
            name=gpu["name"],
            vram_gb=gpu["vram_gb"],
            compute_capability=cc_str,
            cuda_version=env.get("cuda_version"),
            driver_version=None,
        )

    disk = shutil.disk_usage("/")
    disk_free_gb = round(disk.free / (1024**3), 1)

    return SystemInfo(
        gpu=gpu_info,
        has_gpu=env.get("cuda_available", False),
        cpu=platform.processor() or platform.machine(),
        ram_gb=round(psutil.virtual_memory().total / (1024**3), 1),
        os=f"{platform.system()} {platform.release()}",
        python_version=env.get("python_version", platform.python_version()),
        disk_free_gb=disk_free_gb,
    )


def _build_model_list(env: dict) -> list[ModelCompatibility]:
    """Build model compatibility list based on detected hardware.

    Uses a 2GB VRAM headroom buffer for training recommendations.
    A model that technically fits (e.g. 8GB needed on 8.6GB GPU) will
    likely OOM due to OS/CUDA overhead and dynamic memory spikes.
    """
    gpu = env.get("gpu")
    vram = gpu["vram_gb"] if gpu else 0
    # Reserve 2GB for OS, CUDA runtime, and memory spikes during training
    VRAM_HEADROOM_GB = 2

    train_recs = recommend_models(for_training=True)
    infer_recs = recommend_models(for_training=False)

    # Build lookup for inference compatibility
    infer_lookup = {r["model"]: r["fits_local"] for r in infer_recs}

    # Build lookup for config metadata (parameters, license, description, gated)
    config_models = get_supported_models()
    config_lookup = {m["name"]: m for m in config_models}

    results = []
    for rec in train_recs:
        model_name = rec["model"]
        vram_needed = rec.get("vram_needed_gb", 0)
        cfg = config_lookup.get(model_name, {})
        # Apply headroom: model fits only if VRAM > needed + headroom
        can_train = bool(gpu and vram_needed and (vram_needed + VRAM_HEADROOM_GB) <= vram)
        can_infer = infer_lookup.get(model_name, False)

        reason = None
        if not gpu:
            reason = "No GPU detected — CPU only (very slow)"
        elif not can_train and not can_infer:
            reason = f"Needs more VRAM (you have {vram}GB)"
        elif not can_train:
            reason = f"Can chat but not train (needs ~{vram_needed + VRAM_HEADROOM_GB}GB with overhead, you have {vram}GB)"

        results.append(ModelCompatibility(
            name=model_name,
            parameters=cfg.get("parameters", ""),
            can_train=can_train,
            can_infer=can_infer,
            vram_training_gb=rec.get("vram_needed_gb", 0),
            vram_inference_gb=next(
                (r["vram_needed_gb"] for r in infer_recs if r["model"] == model_name),
                0,
            ),
            license=cfg.get("license", ""),
            description=cfg.get("description", ""),
            gated=cfg.get("gated", False),
            reason=reason,
        ))

    return results


@router.get("/info", response_model=SystemInfo)
async def get_system_info():
    """Return local hardware info (GPU, CPU, RAM, disk)."""
    env = get_environment()
    return _build_system_info(env)


@router.get("/models", response_model=list[ModelCompatibility])
async def get_model_compatibility():
    """Return curated models with train/infer compatibility based on local GPU."""
    env = get_environment()
    return _build_model_list(env)


@router.post("/refresh", response_model=SystemInfo)
async def refresh_system_info():
    """Force re-detect hardware (clears cache)."""
    env = refresh_environment()
    return _build_system_info(env)

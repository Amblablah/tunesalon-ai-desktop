from pydantic import BaseModel
from typing import Optional


class GpuInfo(BaseModel):
    name: str
    vram_gb: float
    compute_capability: Optional[str] = None
    cuda_version: Optional[str] = None
    driver_version: Optional[str] = None


class SystemInfo(BaseModel):
    gpu: Optional[GpuInfo] = None
    has_gpu: bool
    cpu: str
    ram_gb: float
    os: str
    python_version: str
    disk_free_gb: float


class ModelCompatibility(BaseModel):
    name: str
    parameters: str
    can_train: bool
    can_infer: bool
    vram_training_gb: int
    vram_inference_gb: int
    license: str
    description: str
    gated: bool = False
    reason: Optional[str] = None

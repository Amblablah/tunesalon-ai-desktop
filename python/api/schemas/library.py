from pydantic import BaseModel
from typing import Optional


class DiskUsage(BaseModel):
    models_gb: float
    adapters_mb: float
    gguf_gb: float
    embeddings_gb: float
    total_gb: float


class BaseModelEntry(BaseModel):
    name: str              # e.g. "microsoft/Phi-4-mini-instruct"
    path: str              # local path
    size_gb: float
    parameters: Optional[str] = None
    downloaded_at: str     # ISO timestamp


class AdapterEntry(BaseModel):
    name: str              # adapter file name
    path: str
    size_mb: float
    base_model: Optional[str] = None
    created_at: str


class GgufEntry(BaseModel):
    name: str
    path: str
    size_gb: float
    quantization: Optional[str] = None
    created_at: str

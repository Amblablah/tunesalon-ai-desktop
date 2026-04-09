from pydantic import BaseModel
from typing import Optional


class AppSettings(BaseModel):
    theme: str = "system"           # "light" | "dark" | "system"
    gpu_mode: str = "auto"          # "auto" | "cpu" | "gpu"
    n_gpu_layers: int = -1          # -1 = auto
    training_defaults: dict = {}
    chat_defaults: dict = {}
    storage_paths: dict = {}        # overrides for model/adapter/gguf dirs


class SettingsUpdate(BaseModel):
    """Partial settings update — all fields optional."""
    theme: Optional[str] = None
    gpu_mode: Optional[str] = None
    n_gpu_layers: Optional[int] = None
    training_defaults: Optional[dict] = None
    chat_defaults: Optional[dict] = None
    storage_paths: Optional[dict] = None

from pydantic import BaseModel
from typing import Optional, List


class LoadModelRequest(BaseModel):
    model_name: str  # HF model ID or local path
    adapter_path: Optional[str] = None  # Optional .adapter file path


class ChatRequest(BaseModel):
    message: str
    system_prompt: Optional[str] = None
    history: Optional[List[dict]] = None  # [{"role": "user", "content": "..."}, ...]
    temperature: float = 0.7
    max_tokens: int = 512


class ChatStreamEvent(BaseModel):
    token: str = ""
    done: bool = False
    error: Optional[str] = None


class LoadAdapterRequest(BaseModel):
    adapter_path: str  # Path to .adapter file


class LoadGgufRequest(BaseModel):
    gguf_path: str  # Path to .gguf file
    n_gpu_layers: int = -1  # -1 = auto, 0 = CPU only
    n_ctx: int = 4096


class ChatStatus(BaseModel):
    model: Optional[str] = None
    adapters: List[str] = []
    engine: Optional[str] = None  # "pytorch", "gguf", or None


class UnloadRequest(BaseModel):
    pass

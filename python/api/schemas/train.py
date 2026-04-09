from pydantic import BaseModel
from typing import Optional


class ModelSearchResult(BaseModel):
    model_id: str
    description: str
    downloads: Optional[int] = None
    parameter_count: Optional[str] = None
    last_modified: Optional[str] = None
    is_curated: bool = False
    vram_training_gb: Optional[float] = None
    vram_inference_gb: Optional[float] = None
    license: Optional[str] = None
    gated: bool = False


class TrainRequest(BaseModel):
    model_name: str
    dataset_path: str
    eval_dataset_path: Optional[str] = None
    adapter_name: Optional[str] = None
    # LoRA config overrides
    lora_r: Optional[int] = None
    lora_alpha: Optional[int] = None
    lora_dropout: Optional[float] = None
    learning_rate: Optional[float] = None
    num_epochs: Optional[int] = None
    batch_size: Optional[int] = None
    gradient_accumulation_steps: Optional[int] = None
    max_seq_length: Optional[int] = None


class TrainProgressEvent(BaseModel):
    status: str  # downloading, preparing, training, saving, complete, error, cancelled
    message: str
    step: Optional[int] = None
    total_steps: Optional[int] = None
    loss: Optional[float] = None
    epoch: Optional[float] = None


class SaveAdapterRequest(BaseModel):
    adapter_name: str
    description: Optional[str] = None
    base_model: Optional[str] = None
    custom_path: Optional[str] = None  # If set, save to this directory instead of default


class GgufExportRequest(BaseModel):
    adapter_path: str
    base_model: str
    quantization: Optional[str] = None  # Q8_0, Q5_K_M, Q4_K_M, Q2_K
    output_name: Optional[str] = None
    custom_path: Optional[str] = None  # If set, save to this directory instead of default


class ModelDownloadRequest(BaseModel):
    model_id: str


class ModelDownloadStatus(BaseModel):
    status: str  # idle, downloading, complete, error, cancelled
    model_id: Optional[str] = None
    progress: Optional[float] = None  # 0-100
    message: Optional[str] = None

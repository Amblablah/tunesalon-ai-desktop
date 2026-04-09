"""LoRA fine-tuning module. Refactored from train.py to be fully parameterized."""

import json
import logging
from pathlib import Path
from typing import Callable, Optional

import yaml

from core.environment import get_environment

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).parent.parent / "desktop_config.yaml"

# Only these config keys may override defaults — prevents injection of
# output_dir, bf16, save_strategy, push_to_hub, etc.
_ALLOWED_CONFIG_KEYS = {
    "lora_r", "lora_alpha", "lora_dropout", "learning_rate",
    "num_epochs", "batch_size", "gradient_accumulation_steps",
    "max_seq_length", "warmup_ratio", "weight_decay",
}


def _load_defaults() -> dict:
    """Load training defaults from desktop_config.yaml."""
    with open(CONFIG_PATH) as f:
        cfg = yaml.safe_load(f)
    return cfg.get("training_defaults", {})


def _validate_dataset(dataset_path: str) -> int:
    """Validate that dataset file exists and contains valid JSONL. Returns line count."""
    path = Path(dataset_path)
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {dataset_path}")
    if not path.suffix == ".jsonl":
        raise ValueError(f"Dataset must be a .jsonl file, got: {path.suffix}")

    line_count = 0
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                raise ValueError(f"Invalid JSON on line {i}: {e}")
            if "messages" not in obj:
                raise ValueError(f"Line {i} missing 'messages' key. Each line must have a 'messages' array.")
            line_count += 1

    if line_count == 0:
        raise ValueError(f"Dataset is empty: {dataset_path}")
    return line_count


def train(
    base_model: str,
    dataset_path: str,
    output_dir: str,
    eval_dataset_path: str = None,
    config: dict = None,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> str:
    """
    Fine-tune a model using LoRA + SFTTrainer.

    Args:
        base_model: HuggingFace model name or local path.
        dataset_path: Path to JSONL training file with chat format.
        output_dir: Where to save the LoRA adapter.
        eval_dataset_path: Optional path to JSONL eval file.
        config: Optional dict of overrides for training settings.
            Keys match desktop_config.yaml training_defaults.
            Example: {"num_epochs": 5, "learning_rate": 2e-4}
        progress_callback: Optional function called with status messages (for UI).

    Returns:
        Path to the saved adapter directory (str).
    """
    import torch
    from datasets import load_dataset
    from peft import LoraConfig, TaskType, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from trl import SFTConfig, SFTTrainer

    # --- Merge defaults with overrides ---
    defaults = _load_defaults()
    if config:
        safe_config = {k: v for k, v in config.items() if k in _ALLOWED_CONFIG_KEYS}
        defaults.update(safe_config)
    cfg = defaults

    def log(msg: str):
        logger.info(msg)
        if progress_callback:
            progress_callback(msg)

    # --- Environment-based precision ---
    env = get_environment()
    gpu = env.get("gpu")
    if gpu and gpu.get("supports_bf16"):
        use_fp16 = False
        use_bf16 = True
    else:
        use_fp16 = True
        use_bf16 = False
    log(f"Precision: {'bf16' if use_bf16 else 'fp16'} (GPU: {gpu['name'] if gpu else 'CPU'})")

    # --- Validate dataset ---
    log("Validating dataset...")
    train_count = _validate_dataset(dataset_path)
    log(f"Training dataset valid: {train_count} examples")

    has_eval = False
    if eval_dataset_path and Path(eval_dataset_path).exists():
        eval_count = _validate_dataset(eval_dataset_path)
        log(f"Eval dataset valid: {eval_count} examples")
        has_eval = True

    # --- Output directory ---
    adapter_path = Path(output_dir)
    adapter_path.mkdir(parents=True, exist_ok=True)

    # --- Load tokenizer ---
    log(f"Loading tokenizer for {base_model}...")
    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # --- Load model ---
    dtype = torch.bfloat16 if use_bf16 else torch.float16
    log(f"Loading model {base_model}...")
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        dtype=dtype,
        device_map="auto",
        trust_remote_code=True,
    )
    model.config.use_cache = False  # Required for gradient checkpointing

    log(f"Model loaded. Parameters: {model.num_parameters():,}")

    # --- Configure LoRA ---
    lora_target = cfg.get("lora_target_modules", "all")
    if lora_target == "all":
        lora_target = "all-linear"

    log("Configuring LoRA adapter...")
    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=cfg.get("lora_r", 16),
        lora_alpha=cfg.get("lora_alpha", 32),
        lora_dropout=cfg.get("lora_dropout", 0.05),
        target_modules=lora_target,
    )
    model = get_peft_model(model, lora_config)
    trainable, total = model.get_nb_trainable_parameters()
    log(f"LoRA applied. Trainable: {trainable:,} / {total:,} ({100 * trainable / total:.2f}%)")

    # --- Load dataset ---
    log(f"Loading training data from {dataset_path}...")
    data_files = {"train": str(dataset_path)}
    if has_eval:
        data_files["eval"] = str(eval_dataset_path)
    dataset = load_dataset("json", data_files=data_files)

    # --- Training config ---
    training_args = SFTConfig(
        output_dir=str(adapter_path),
        num_train_epochs=cfg.get("num_epochs", 3),
        per_device_train_batch_size=cfg.get("batch_size", 1),
        gradient_accumulation_steps=cfg.get("gradient_accumulation_steps", 4),
        learning_rate=cfg.get("learning_rate", 1e-4),
        warmup_ratio=cfg.get("warmup_ratio", 0.1),
        weight_decay=cfg.get("weight_decay", 0.01),
        logging_steps=1,
        save_strategy="epoch",
        eval_strategy="epoch" if has_eval else "no",
        fp16=use_fp16,
        bf16=use_bf16,
        gradient_checkpointing=cfg.get("gradient_checkpointing", True),
        max_length=cfg.get("max_seq_length", 2048),
        report_to="none",
        remove_unused_columns=False,
    )

    # --- Custom callback for step-level progress ---
    from transformers import TrainerCallback

    class ProgressCallback(TrainerCallback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            if state.global_step > 0 and state.max_steps > 0:
                loss_val = logs.get("loss", None) if logs else None
                loss_str = f" - loss: {loss_val:.4f}" if loss_val is not None else ""
                epoch_str = f" - epoch: {state.epoch:.2f}" if state.epoch is not None else ""
                log(f"Step {state.global_step}/{state.max_steps}{loss_str}{epoch_str}")

    # --- Train ---
    log("Starting training...")
    try:
        trainer = SFTTrainer(
            model=model,
            args=training_args,
            train_dataset=dataset["train"],
            eval_dataset=dataset.get("eval"),
            processing_class=tokenizer,
            callbacks=[ProgressCallback()],
        )
        train_result = trainer.train()
        log(f"Training complete! Final loss: {train_result.training_loss:.4f}")
    except RuntimeError as e:
        if "out of memory" in str(e).lower():
            # Clear GPU memory before raising
            del model, trainer
            torch.cuda.empty_cache()
            raise RuntimeError(
                "Out of VRAM! Try:\n"
                "  1. Reduce max_seq_length (e.g. 512)\n"
                "  2. Reduce gradient_accumulation_steps\n"
                "  3. Use a smaller model"
            ) from e
        raise

    # --- Save adapter only (no base model merge) ---
    model.save_pretrained(str(adapter_path))
    tokenizer.save_pretrained(str(adapter_path))
    log(f"Adapter saved to {adapter_path}")

    # Clean up checkpoint directories left by SFTTrainer (they contain optimizer
    # state and duplicate adapter weights, making the directory 750MB+ instead of ~30-50MB)
    import shutil
    for child in adapter_path.iterdir():
        if child.is_dir() and child.name.startswith("checkpoint-"):
            shutil.rmtree(child, ignore_errors=True)
    # Also remove training artifacts that aren't part of the adapter
    for artifact in ["training_args.bin", "trainer_state.json"]:
        artifact_path = adapter_path / artifact
        if artifact_path.exists():
            artifact_path.unlink()
    # Remove duplicate .bin weights when .safetensors exists (saves ~50% file size)
    safetensors_path = adapter_path / "adapter_model.safetensors"
    bin_path = adapter_path / "adapter_model.bin"
    if safetensors_path.exists() and bin_path.exists():
        bin_path.unlink()
        log("Removed duplicate adapter_model.bin (safetensors preferred)")

    # Clean up GPU memory
    del model, trainer
    torch.cuda.empty_cache()

    return str(adapter_path)

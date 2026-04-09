"""Chat inference module. Refactored from test_model.py."""

import logging
from pathlib import Path
from typing import Optional

from core.environment import get_environment

logger = logging.getLogger(__name__)


class ChatModel:
    """Load a base model (with optional LoRA adapter) for chat inference."""

    def __init__(
        self,
        base_model: str,
        adapter_path: str = None,
        device: str = "auto",
    ):
        """
        Load model for inference.

        Args:
            base_model: HuggingFace model name or local path.
            adapter_path: Optional path to LoRA adapter folder.
            device: "auto", "cuda", or "cpu".
        """
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        env = get_environment()
        gpu = env.get("gpu")

        # Determine dtype from environment
        if gpu and gpu.get("supports_bf16"):
            self._dtype = torch.bfloat16
        else:
            self._dtype = torch.float16

        # Determine device
        if device == "auto":
            self._device_map = "auto" if (gpu and env.get("cuda_available")) else "cpu"
        else:
            self._device_map = device

        precision = "bf16" if self._dtype == torch.bfloat16 else "fp16"
        logger.info(f"Loading {base_model} ({precision}, device={self._device_map})")

        # Load tokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        # Load base model
        self.model = AutoModelForCausalLM.from_pretrained(
            base_model,
            dtype=self._dtype,
            device_map=self._device_map,
            trust_remote_code=True,
        )
        self.model.eval()
        self.base_model_name = base_model
        self._adapter_name = None

        # Load adapter if provided
        if adapter_path:
            self.swap_adapter(adapter_path)

        logger.info("Model loaded and ready for inference.")

    def chat(
        self,
        message: str,
        system_prompt: str = None,
        history: list = None,
        max_new_tokens: int = 512,
        temperature: float = 0.7,
    ) -> str:
        """
        Send a message and get a response.

        Args:
            message: The user's input.
            system_prompt: Optional system prompt.
            history: Previous turns as [{"role": "user"|"assistant", "content": "..."}].
            max_new_tokens: Max tokens to generate.
            temperature: Sampling temperature (0.0 for greedy).

        Returns:
            The model's response text.
        """
        import torch

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": message})

        text = self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = self.tokenizer(text, return_tensors="pt").to(self.model.device)

        do_sample = temperature > 0.0
        gen_kwargs = dict(
            max_new_tokens=max_new_tokens,
            pad_token_id=self.tokenizer.pad_token_id or self.tokenizer.eos_token_id,
        )
        if do_sample:
            gen_kwargs["temperature"] = temperature
            gen_kwargs["top_p"] = 0.9
            gen_kwargs["do_sample"] = True

        with torch.no_grad():
            outputs = self.model.generate(**inputs, **gen_kwargs)

        new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
        response = self.tokenizer.decode(new_tokens, skip_special_tokens=True)
        return response.strip()

    def swap_adapter(self, adapter_path: str):
        """
        Load or swap to a different LoRA adapter WITHOUT reloading the base model.

        Args:
            adapter_path: Path to the LoRA adapter directory.
        """
        from peft import PeftModel

        adapter_path = str(adapter_path)
        adapter_name = Path(adapter_path).name

        # Verify adapter files exist
        adapter_dir = Path(adapter_path)
        config_file = adapter_dir / "adapter_config.json"
        if not config_file.exists():
            raise FileNotFoundError(
                f"No adapter_config.json found in {adapter_path}. "
                "This doesn't appear to be a valid LoRA adapter directory."
            )

        if self._adapter_name is None:
            # First adapter — wrap base model with PeftModel
            logger.info(f"Loading first adapter from {adapter_path}...")
            self.model = PeftModel.from_pretrained(self.model, adapter_path)
            self.model.eval()
            logger.info(f"PeftModel active adapters: {self.model.active_adapters}")
        else:
            # Already have an adapter — load new one and switch
            logger.info(f"Swapping adapter to {adapter_path}...")
            self.model.load_adapter(adapter_path, adapter_name=adapter_name)
            self.model.set_adapter(adapter_name)
            logger.info(f"PeftModel active adapters: {self.model.active_adapters}")

        self._adapter_name = adapter_name

        # Load tokenizer from adapter dir if it has one, otherwise keep current
        adapter_tokenizer_path = Path(adapter_path) / "tokenizer_config.json"
        if adapter_tokenizer_path.exists():
            from transformers import AutoTokenizer
            self.tokenizer = AutoTokenizer.from_pretrained(adapter_path, trust_remote_code=True)
            if self.tokenizer.pad_token is None:
                self.tokenizer.pad_token = self.tokenizer.eos_token

        logger.info(f"Adapter loaded: {adapter_path}")

    def remove_adapter(self):
        """Remove all adapters, revert to base model behavior."""
        if self._adapter_name is None:
            logger.info("No adapter loaded, nothing to remove.")
            return

        self.model = self.model.unload()
        self.model.eval()
        self._adapter_name = None

        # Restore base tokenizer
        from transformers import AutoTokenizer
        self.tokenizer = AutoTokenizer.from_pretrained(
            self.base_model_name, trust_remote_code=True
        )
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        logger.info("Adapter removed. Using base model.")

    def unload(self):
        """Free all GPU memory."""
        import torch
        import gc

        del self.model
        del self.tokenizer
        self.model = None
        self.tokenizer = None
        self._adapter_name = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("Model unloaded, GPU memory freed.")

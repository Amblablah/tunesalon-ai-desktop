"""Export module: GGUF conversion and adapter packaging. Refactored from merge_model.py."""

import json
import logging
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import yaml

from core.environment import get_environment

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).parent.parent / "desktop_config.yaml"


def _is_frozen() -> bool:
    """Check if running as a PyInstaller frozen executable."""
    return getattr(sys, 'frozen', False)


def _get_bundle_dir() -> Path:
    """Get the PyInstaller bundle's _internal directory (or script dir in dev)."""
    if _is_frozen():
        return Path(sys._MEIPASS)
    return Path(__file__).parent.parent


def _get_convert_script() -> Path:
    """Find convert_hf_to_gguf.py — bundled resource or llama.cpp clone."""
    if _is_frozen():
        bundled = _get_bundle_dir() / "llama_cpp_scripts" / "convert_hf_to_gguf.py"
        if bundled.exists():
            return bundled
    # Dev mode: use llama_cpp_path from config
    export_cfg = _load_export_config()
    llama_cpp_path = Path(export_cfg.get("llama_cpp_path", "llama_cpp"))
    return llama_cpp_path / "convert_hf_to_gguf.py"


def _get_python_exe() -> str:
    """Get Python executable for running scripts (system Python in dev mode)."""
    return sys.executable


def _run_convert_in_process(convert_script: Path, merged_dir: str, outfile: str, outtype: str) -> None:
    """Run convert_hf_to_gguf.py in-process by importing it as a module.
    Used in frozen mode where subprocess to a separate Python is not viable."""
    import importlib
    import importlib.util
    old_argv = sys.argv
    old_path = sys.path[:]
    try:
        # The convert script needs llama.cpp's gguf package (has MistralTokenizerType),
        # not the pip gguf package (baked into PyInstaller's archive).
        # Prepend the script's parent dir so "import gguf" finds llama.cpp's version.
        script_dir = str(convert_script.parent)
        sys.path.insert(0, script_dir)

        # Force reload gguf from the new path (llama.cpp's version)
        if 'gguf' in sys.modules:
            # Remove all cached gguf submodules
            to_remove = [k for k in sys.modules if k == 'gguf' or k.startswith('gguf.')]
            for k in to_remove:
                del sys.modules[k]

        sys.argv = [str(convert_script), merged_dir, "--outfile", outfile, "--outtype", outtype]
        spec = importlib.util.spec_from_file_location("__main__", str(convert_script))
        module = importlib.util.module_from_spec(spec)
        module.__name__ = "__main__"
        spec.loader.exec_module(module)
    finally:
        sys.argv = old_argv
        sys.path[:] = old_path


def _get_quantize_bin() -> Path | None:
    """Find llama-quantize binary — bundled or from llama.cpp build."""
    if _is_frozen():
        bundled = _get_bundle_dir() / "llama_cpp_bin" / "llama-quantize.exe"
        if bundled.exists():
            return bundled
    # Dev mode: use llama_cpp_path from config
    export_cfg = _load_export_config()
    llama_cpp_path = Path(export_cfg.get("llama_cpp_path", "llama_cpp"))
    quantize = llama_cpp_path / "build" / "bin" / "llama-quantize"
    if not quantize.exists():
        quantize = quantize.with_suffix(".exe")
    return quantize if quantize.exists() else None


def _load_export_config() -> dict:
    """Load GGUF export settings from desktop_config.yaml."""
    with open(CONFIG_PATH) as f:
        cfg = yaml.safe_load(f)
    return cfg.get("gguf_export", {})


def merge_and_export_gguf(
    base_model: str,
    adapter_path: str,
    output_path: str,
    quantization: str = None,
    llama_cpp_path: str = None,
    progress_callback=None,
) -> str:
    """
    Merge LoRA adapter into base model and export as a single GGUF file.

    Args:
        base_model: HuggingFace model name or local path.
        adapter_path: Path to the LoRA adapter directory.
        output_path: Where to save the GGUF file (e.g. "outputs/my_model.gguf").
        quantization: GGUF quantization type (e.g. "Q4_K_M", "Q8_0", "f16").
            If None, uses default from desktop_config.yaml.
        llama_cpp_path: Path to llama.cpp directory. Uses config default if None.
        progress_callback: Optional function called with status messages.

    Returns:
        Path to the GGUF file (str).
    """
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    export_cfg = _load_export_config()

    if quantization is None:
        quantization = export_cfg.get("default_quantization", "Q4_K_M")

    convert_script = _get_convert_script()
    if not convert_script.exists():
        raise FileNotFoundError(
            f"GGUF convert script not found at {convert_script}. "
            f"Ensure llama.cpp is available."
        )

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    def log(msg: str):
        logger.info(msg)
        if progress_callback:
            progress_callback(msg)

    # Determine dtype from environment
    env = get_environment()
    gpu = env.get("gpu")
    if gpu and gpu.get("supports_bf16"):
        dtype = torch.bfloat16
    else:
        dtype = torch.float16

    # Step 1: Merge adapter into base model (on CPU to save VRAM)
    log(f"Loading base model {base_model} on CPU for merging...")
    model = AutoModelForCausalLM.from_pretrained(
        base_model,
        dtype=dtype,
        device_map="cpu",
    )

    log("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)

    log(f"Loading LoRA adapter from {adapter_path}...")
    model = PeftModel.from_pretrained(model, str(adapter_path))

    log("Merging adapter into base model...")
    model = model.merge_and_unload()

    # Step 2: Save merged model to a temp directory
    merged_dir = output_path.parent / "_merged_temp"
    merged_dir.mkdir(parents=True, exist_ok=True)
    log(f"Saving merged model to temp dir...")
    model.save_pretrained(str(merged_dir))
    tokenizer.save_pretrained(str(merged_dir))

    # Free memory
    del model
    import gc
    gc.collect()

    # Steps 3-5 wrapped in try/finally so _merged_temp is always cleaned up
    try:
        # Step 3: Convert to GGUF using llama.cpp script
        output_file = str(output_path)
        outtype = "f16"
        if quantization.lower() in ("f16", "fp16"):
            outtype = "f16"
        elif quantization.lower() in ("f32", "fp32"):
            outtype = "f32"
        else:
            outtype = "f16"  # convert to f16 first, then quantize separately

        log(f"Converting to GGUF (outtype={outtype})...")
        if _is_frozen():
            try:
                log(f"Running convert in-process: script={convert_script}, merged={merged_dir}, out={output_file}, type={outtype}")
                _run_convert_in_process(convert_script, str(merged_dir), output_file, outtype)
            except SystemExit as e:
                if e.code != 0 and e.code is not None:
                    raise RuntimeError(f"GGUF conversion failed with exit code {e.code}")
                log("Convert script completed (exit 0)")
            except Exception as e:
                raise RuntimeError(f"GGUF conversion failed: {e}")
            if not Path(output_file).exists():
                parent = Path(output_file).parent
                found = list(parent.glob("*.gguf"))
                log(f"Expected output at {output_file} not found. Files in {parent}: {found}")
        else:
            cmd = [
                _get_python_exe(),
                str(convert_script),
                str(merged_dir),
                "--outfile", output_file,
                "--outtype", outtype,
            ]
            _flags = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=600, **_flags)
            if result.returncode != 0:
                raise RuntimeError(f"GGUF conversion failed:\n{result.stderr}")

        # Step 4: Quantize if needed (f16 was just the intermediate step)
        if quantization.lower() not in ("f16", "fp16", "f32", "fp32"):
            quantize_bin = _get_quantize_bin()
            if quantize_bin:
                log(f"Quantizing to {quantization}...")
                quantized_output = str(output_path).replace(".gguf", f"_{quantization}.gguf")
                qcmd = [str(quantize_bin), output_file, quantized_output, quantization]
                _flags = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
                qresult = subprocess.run(qcmd, capture_output=True, text=True, timeout=600, **_flags)
                if qresult.returncode != 0:
                    log(f"Quantization failed (keeping f16): {qresult.stderr[:200]}")
                else:
                    Path(output_file).unlink()
                    Path(quantized_output).rename(output_file)
                    log(f"Quantized to {quantization}")
            else:
                log(f"llama-quantize not found. Keeping f16 output.")
    finally:
        # Step 5: Always clean up temp merged directory
        shutil.rmtree(merged_dir, ignore_errors=True)

    # Validate output
    output_file_path = Path(output_file)
    if not output_file_path.exists() or output_file_path.stat().st_size == 0:
        raise RuntimeError(f"GGUF export failed: output file missing or empty at {output_file}")

    size_mb = output_file_path.stat().st_size / (1024 * 1024)
    log(f"GGUF exported: {output_file} ({size_mb:.0f} MB)")

    return output_file


def export_adapter_only(
    adapter_path: str,
    output_path: str,
    metadata: dict = None,
) -> str:
    """
    Package just the LoRA adapter files with metadata.

    Args:
        adapter_path: Path to the LoRA adapter directory.
        output_path: Where to save the packaged adapter directory.
        metadata: Optional dict with extra info (base_model, training_config, etc.).

    Returns:
        Path to the packaged adapter directory (str).
    """
    adapter_path = Path(adapter_path)
    output_path = Path(output_path)

    if not adapter_path.exists():
        raise FileNotFoundError(f"Adapter not found: {adapter_path}")

    # Copy adapter files to output
    output_path.mkdir(parents=True, exist_ok=True)

    # Files to include from the adapter directory
    # Prefer safetensors over .bin (safetensors is smaller and faster to load)
    has_safetensors = (adapter_path / "adapter_model.safetensors").exists()
    adapter_files = [
        "adapter_config.json",
        "adapter_model.safetensors",
        "tokenizer.json",
        "tokenizer_config.json",
        "chat_template.jinja",
        "special_tokens_map.json",
        "README.md",
    ]
    # Only include .bin if safetensors doesn't exist (legacy fallback)
    if not has_safetensors:
        adapter_files.append("adapter_model.bin")

    copied = []
    for fname in adapter_files:
        src = adapter_path / fname
        if src.exists():
            shutil.copy2(src, output_path / fname)
            copied.append(fname)

    # Build and write metadata
    meta = {
        "exported_at": datetime.now().isoformat(),
        "source_adapter": str(adapter_path),
    }

    # Try to read base model name from adapter_config.json
    adapter_config_file = adapter_path / "adapter_config.json"
    if adapter_config_file.exists():
        with open(adapter_config_file) as f:
            adapter_cfg = json.load(f)
        meta["base_model"] = adapter_cfg.get("base_model_name_or_path", "unknown")

    if metadata:
        meta.update(metadata)

    with open(output_path / "export_metadata.json", "w") as f:
        json.dump(meta, f, indent=2)
    copied.append("export_metadata.json")

    # Calculate total size
    total_size = sum((output_path / f).stat().st_size for f in copied if (output_path / f).exists())
    size_mb = total_size / (1024 * 1024)

    logger.info(f"Adapter exported: {output_path} ({len(copied)} files, {size_mb:.1f} MB)")

    return str(output_path)

"""Standalone GGUF inference server — runs as a separate process to avoid
CUDA DLL conflicts between PyTorch (bundled in main sidecar) and llama-cpp-python.

Started by the main sidecar on demand when a GGUF model is loaded.
Communicates via HTTP on a dynamic port passed as argv[1].

Root cause: PyInstaller's bootloader calls SetDllDirectory() pointing to _internal/,
which is inherited by child processes. That dir contains PyTorch's CUDA 13 DLLs.
When llama.cpp (CUDA 12) loads, it picks up the wrong CUDA runtime and crashes.
Fix: call SetDllDirectoryW(None) to reset DLL search order before importing llama_cpp.
"""
import ctypes
import gc
import json
import os
import sys
from pathlib import Path

# --- DLL search order fix (MUST run before any native imports) ---
# Reset inherited SetDllDirectory from PyInstaller's bootloader
ctypes.windll.kernel32.SetDllDirectoryW(None)
# Remove _internal paths from PATH
_clean_parts = [p for p in os.environ.get("PATH", "").split(";") if "_internal" not in p]
os.environ["PATH"] = ";".join(_clean_parts)

from llama_cpp import Llama  # noqa: E402 — must be after DLL fix
from fastapi import FastAPI  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402
import uvicorn  # noqa: E402

app = FastAPI()

_model = None
_model_path = None


class LoadRequest(BaseModel):
    gguf_path: str
    n_gpu_layers: int = -1
    n_ctx: int = 4096


class ChatRequest(BaseModel):
    messages: list
    temperature: float = 0.7
    max_tokens: int = 512


@app.post("/load")
def load_model(req: LoadRequest):
    global _model, _model_path

    path = Path(req.gguf_path)
    if not path.exists():
        return {"error": f"File not found: {req.gguf_path}"}

    # Unload previous
    if _model is not None:
        del _model
        _model = None
        gc.collect()

    n_gpu = req.n_gpu_layers
    if n_gpu == -1:
        # Auto-detect GPU layers based on file size vs VRAM.
        # Do NOT import torch here — torch's __init__ calls os.add_dll_directory()
        # for CUDA 13, which corrupts llama.cpp's CUDA 12 DLL resolution and crashes.
        try:
            import subprocess as _sp
            _flags = {"creationflags": _sp.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
            result = _sp.run(
                [sys.executable, "-c",
                 "import torch; print(torch.cuda.is_available()); "
                 "print(torch.cuda.get_device_properties(0).total_mem / (1024**3)) "
                 "if torch.cuda.is_available() else print(0)"],
                capture_output=True, text=True, timeout=10,
                **_flags,
            )
            lines = result.stdout.strip().splitlines()
            if lines and lines[0] == "True":
                vram = float(lines[1])
                file_gb = path.stat().st_size / (1024 ** 3)
                n_gpu = -1 if file_gb < vram * 0.8 else 0
            else:
                n_gpu = 0
        except Exception:
            n_gpu = 0

    _model = Llama(
        model_path=str(path),
        n_gpu_layers=n_gpu,
        n_ctx=req.n_ctx,
        verbose=False,
    )
    _model_path = str(path)
    return {"status": "ok", "model": path.stem, "n_gpu_layers": n_gpu}


@app.post("/chat")
def chat(req: ChatRequest):
    if _model is None:
        return {"error": "No model loaded"}

    def stream():
        gen = _model.create_chat_completion(
            messages=req.messages,
            temperature=req.temperature,
            max_tokens=req.max_tokens,
            stream=True,
        )
        for chunk in gen:
            delta = chunk.get("choices", [{}])[0].get("delta", {})
            token = delta.get("content", "")
            if token:
                yield f"data: {json.dumps({'token': token})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/unload")
def unload():
    global _model, _model_path
    if _model is not None:
        del _model
        _model = None
        gc.collect()
    _model_path = None
    return {"status": "ok"}


@app.get("/status")
def status():
    return {
        "loaded": _model is not None,
        "model": Path(_model_path).stem if _model_path else None,
    }


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")

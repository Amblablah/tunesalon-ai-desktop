"""GGUF inference module — chat via llama-cpp-python (CPU or GPU).

In frozen mode (PyInstaller), llama-cpp-python's CUDA 12 DLLs conflict with
PyTorch's CUDA 13 DLLs. To avoid crashes, GGUF inference runs in a separate
Python process (gguf_server.py) using the system Python installation.

In dev mode, llama_cpp is loaded directly in-process (no conflict).
"""

import gc
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Generator, Optional

import requests

logger = logging.getLogger(__name__)


class GgufChatModel:
    """Chat inference using llama.cpp (GGUF files). Runs on CPU or GPU."""

    def __init__(
        self,
        gguf_path: str,
        n_gpu_layers: int = -1,
        n_ctx: int = 4096,
    ):
        path = Path(gguf_path)
        if not path.exists():
            raise FileNotFoundError(f"GGUF file not found: {gguf_path}")
        if not path.suffix == ".gguf":
            raise ValueError(f"Expected a .gguf file, got: {path.name}")

        self._gguf_path = str(path)
        self._model_name = path.stem
        self._subprocess = None
        self._subprocess_port = None

        if getattr(sys, 'frozen', False):
            # Frozen mode: start gguf_server.py as a separate process
            self._start_subprocess(gguf_path, n_gpu_layers, n_ctx)
        else:
            # Dev mode: load directly
            self._model = self._load_direct(gguf_path, n_gpu_layers, n_ctx)

        logger.info(f"GGUF model loaded: {path.name}")

    def _load_direct(self, gguf_path: str, n_gpu_layers: int, n_ctx: int):
        """Load llama_cpp directly in-process (dev mode only)."""
        from llama_cpp import Llama

        if n_gpu_layers == -1:
            n_gpu_layers = self._auto_gpu_layers(gguf_path)

        return Llama(
            model_path=gguf_path,
            n_gpu_layers=n_gpu_layers,
            n_ctx=n_ctx,
            verbose=False,
        )

    def _start_subprocess(self, gguf_path: str, n_gpu_layers: int, n_ctx: int):
        """Start gguf_server.py as a separate Python process."""
        python_path = shutil.which("python") or shutil.which("python3")
        if not python_path:
            raise RuntimeError(
                "GGUF chat requires Python installed on your system. "
                "Please install Python 3.10+ from python.org."
            )

        # Find gguf_server.py
        server_script = Path(__file__).parent.parent / "gguf_server.py"
        if not server_script.exists():
            raise RuntimeError(f"gguf_server.py not found at {server_script}")

        self._subprocess_port = 8766
        logger.info(f"Starting GGUF subprocess on port {self._subprocess_port}")

        # Log stderr to a file for debugging crashes
        appdata = os.environ.get("APPDATA", "")
        log_dir = Path(appdata) / "TuneSalonDesktop" if appdata else Path.home()
        self._gguf_log = log_dir / "gguf_server.log"

        logger.info(f"Starting GGUF subprocess: {python_path} {server_script} {self._subprocess_port}")
        logger.info(f"GGUF server log: {self._gguf_log}")

        # CRITICAL: cwd must NOT be the _internal/ dir — PyTorch's CUDA 13 DLLs
        # there conflict with llama-cpp-python's CUDA 12 DLLs on Windows DLL search.
        neutral_cwd = str(Path.home())

        self._log_file = open(self._gguf_log, 'w')
        # Hide the console window on Windows
        kwargs = {}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        self._subprocess = subprocess.Popen(
            [python_path, str(server_script), str(self._subprocess_port)],
            stdout=self._log_file,
            stderr=self._log_file,
            cwd=neutral_cwd,
            **kwargs,
        )

        # Wait for subprocess to be ready
        url = f"http://127.0.0.1:{self._subprocess_port}/health"
        for _ in range(30):  # 15 seconds max
            time.sleep(0.5)
            if self._subprocess.poll() is not None:
                log_content = self._gguf_log.read_text(errors='replace')[-500:] if self._gguf_log.exists() else "no log"
                raise RuntimeError(f"GGUF server exited unexpectedly: {log_content}")
            try:
                r = requests.get(url, timeout=1)
                if r.status_code == 200:
                    break
            except requests.ConnectionError:
                continue
        else:
            self._kill_subprocess()
            raise RuntimeError("GGUF server failed to start within 15 seconds")

        # Load the model via the subprocess
        load_url = f"http://127.0.0.1:{self._subprocess_port}/load"
        try:
            r = requests.post(load_url, json={
                "gguf_path": gguf_path,
                "n_gpu_layers": n_gpu_layers,
                "n_ctx": n_ctx,
            }, timeout=120)
            result = r.json()
            if "error" in result:
                self._kill_subprocess()
                raise RuntimeError(result["error"])
        except requests.ConnectionError:
            # Subprocess crashed during model load
            log_content = ""
            if hasattr(self, '_gguf_log') and self._gguf_log.exists():
                try:
                    self._log_file.flush()
                    log_content = self._gguf_log.read_text(errors='replace')[-500:]
                except Exception:
                    pass
            self._kill_subprocess()
            raise RuntimeError(f"GGUF server crashed during model load. {log_content}")

    def _kill_subprocess(self):
        if self._subprocess and self._subprocess.poll() is None:
            self._subprocess.terminate()
            try:
                self._subprocess.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._subprocess.kill()
        self._subprocess = None
        if hasattr(self, '_log_file') and self._log_file and not self._log_file.closed:
            self._log_file.close()

    def _auto_gpu_layers(self, gguf_path: str) -> int:
        """Auto-detect how many layers to offload to GPU based on VRAM."""
        try:
            from core.environment import get_environment
            env = get_environment()
            gpu = env.get("gpu")

            if not gpu or not env.get("cuda_available"):
                return 0

            try:
                from api.routers.train import _train_state
                if _train_state["status"] in ("preparing", "training", "saving"):
                    return 0
            except (ImportError, KeyError):
                pass

            file_size_gb = Path(gguf_path).stat().st_size / (1024 ** 3)
            vram_gb = gpu.get("vram_gb", 0)

            if vram_gb <= 0:
                return 0
            if file_size_gb < vram_gb * 0.8:
                return -1
            fraction = (vram_gb * 0.7) / file_size_gb
            return max(1, int(fraction * 35))

        except Exception as e:
            logger.warning(f"Auto GPU detection failed, using CPU: {e}")
            return 0

    def chat(
        self,
        messages: list,
        temperature: float = 0.7,
        max_tokens: int = 512,
    ) -> Generator[str, None, None]:
        """Streaming chat. Yields tokens one at a time."""
        if self._subprocess is not None:
            # Subprocess mode
            yield from self._chat_subprocess(messages, temperature, max_tokens)
        else:
            # Direct mode
            yield from self._chat_direct(messages, temperature, max_tokens)

    def _chat_direct(self, messages, temperature, max_tokens):
        stream = self._model.create_chat_completion(
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        for chunk in stream:
            delta = chunk.get("choices", [{}])[0].get("delta", {})
            token = delta.get("content", "")
            if token:
                yield token

    def _chat_subprocess(self, messages, temperature, max_tokens):
        url = f"http://127.0.0.1:{self._subprocess_port}/chat"
        r = requests.post(url, json={
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }, stream=True, timeout=300)

        for line in r.iter_lines(decode_unicode=True):
            if line and line.startswith("data: "):
                try:
                    data = json.loads(line[6:])
                    if data.get("done"):
                        return
                    token = data.get("token", "")
                    if token:
                        yield token
                except json.JSONDecodeError:
                    continue

    def unload(self):
        """Free model from memory."""
        if self._subprocess is not None:
            try:
                requests.post(
                    f"http://127.0.0.1:{self._subprocess_port}/unload",
                    timeout=5,
                )
            except Exception:
                pass
            self._kill_subprocess()
        elif hasattr(self, '_model') and self._model is not None:
            del self._model
            self._model = None

        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass

        logger.info("GGUF model unloaded.")

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def gguf_path(self) -> str:
        return self._gguf_path

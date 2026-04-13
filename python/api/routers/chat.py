"""Chat router — local PyTorch inference with adapter stacking and RAG."""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse

from api.config import get_config
from api.schemas.chat import (
    LoadModelRequest, ChatRequest, ChatStreamEvent,
    LoadAdapterRequest, LoadGgufRequest, ChatStatus, UnloadRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# --- Single-user global state ---
_chat_model = None  # core.inference.ChatModel instance (PyTorch)
_gguf_model = None  # core.gguf_inference.GgufChatModel instance
_engine_type: Optional[str] = None  # "pytorch" or "gguf"
_loaded_model_name: Optional[str] = None
_loaded_adapters: list[str] = []  # List of loaded adapter names/paths
_adapter_temp_dirs: list[str] = []  # Temp dirs for extracted .adapter files
_rag_engine = None  # core.rag.RAGEngine instance
_rag_temp_dir: Optional[str] = None  # Temp dir for uploaded RAG documents
_chat_lock = threading.Lock()

MAX_ADAPTERS = 5


def _is_gpu_busy() -> bool:
    """Check if training is running (GPU lock)."""
    try:
        from api.routers.train import _train_state
        return _train_state["status"] in ("preparing", "training", "saving")
    except (ImportError, KeyError):
        return False


def _extract_adapter(adapter_path: str) -> str:
    """Extract a .adapter zip file to a temp directory. Returns extracted dir path."""
    adapter_file = Path(adapter_path)
    if not adapter_file.exists():
        raise FileNotFoundError(f"Adapter file not found: {adapter_path}")

    if not adapter_file.suffix == ".adapter":
        # Assume it's already an extracted directory
        if adapter_file.is_dir():
            return str(adapter_file)
        raise ValueError(f"Expected .adapter file or directory, got: {adapter_path}")

    temp_dir = tempfile.mkdtemp(prefix="tunesalon_adapter_")
    try:
        with zipfile.ZipFile(adapter_file, "r") as zf:
            zf.extractall(temp_dir)
    except zipfile.BadZipFile:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise ValueError("This doesn't appear to be a valid .adapter file")

    _adapter_temp_dirs.append(temp_dir)
    return temp_dir


def _cleanup_adapter_temps():
    """Clean up all temporary adapter directories."""
    global _adapter_temp_dirs
    for temp_dir in _adapter_temp_dirs:
        shutil.rmtree(temp_dir, ignore_errors=True)
    _adapter_temp_dirs.clear()


def _unload_current_engine():
    """Unload whichever engine is currently active (PyTorch or GGUF)."""
    global _chat_model, _gguf_model, _engine_type, _loaded_model_name, _loaded_adapters
    if _chat_model is not None:
        _chat_model.unload()
        _chat_model = None
    if _gguf_model is not None:
        _gguf_model.unload()
        _gguf_model = None
    _engine_type = None
    _loaded_model_name = None
    _loaded_adapters.clear()
    _cleanup_adapter_temps()


def _cleanup_rag():
    """Clean up RAG engine and temp files."""
    global _rag_engine, _rag_temp_dir
    if _rag_engine:
        _rag_engine.clear()
        _rag_engine = None
    if _rag_temp_dir:
        shutil.rmtree(_rag_temp_dir, ignore_errors=True)
        _rag_temp_dir = None


# ========================
# LOAD MODEL
# ========================

@router.post("/load-model")
async def load_model(req: LoadModelRequest):
    """Load a base model (+ optional adapter). Auto-detects .gguf files."""
    global _chat_model, _gguf_model, _engine_type, _loaded_model_name, _loaded_adapters

    # Check if this is a .gguf file — route to GGUF engine
    if req.model_name.lower().endswith(".gguf") or Path(req.model_name).suffix.lower() == ".gguf":
        gguf_req = LoadGgufRequest(gguf_path=req.model_name)
        return await load_gguf(gguf_req)

    if _is_gpu_busy():
        raise HTTPException(
            409,
            "Your GPU is currently being used for training. "
            "Please wait for training to finish before starting a chat."
        )

    with _chat_lock:
        # Unload existing engine first
        _unload_current_engine()

        # Resolve model path: check if downloaded locally
        config = get_config()
        models_dir = config["paths"]["models_dir"]
        safe_name = req.model_name.replace("/", "--")
        local_model = Path(models_dir) / safe_name
        actual_model = str(local_model) if local_model.exists() else req.model_name

        # Handle optional adapter
        adapter_dir = None
        if req.adapter_path:
            adapter_dir = _extract_adapter(req.adapter_path)

        try:
            from core.inference import ChatModel
            _chat_model = ChatModel(
                base_model=actual_model,
                adapter_path=adapter_dir,
            )
            _engine_type = "pytorch"
            _loaded_model_name = req.model_name
            adapter_system_prompt = None
            if adapter_dir:
                _loaded_adapters.append(req.adapter_path)
                # Read system prompt from adapter metadata
                metadata_path = Path(adapter_dir) / "adapter_metadata.json"
                if metadata_path.exists():
                    try:
                        meta = json.loads(metadata_path.read_text(encoding="utf-8"))
                        adapter_system_prompt = meta.get("system_prompt")
                    except Exception:
                        pass

            return {
                "status": "ok",
                "model": req.model_name,
                "adapter": req.adapter_path,
                "engine": "pytorch",
                "message": f"Model loaded: {req.model_name}",
                "system_prompt": adapter_system_prompt,
            }
        except Exception as e:
            _unload_current_engine()
            logger.error(f"Failed to load model: {e}", exc_info=True)
            raise HTTPException(500, f"Couldn't load this model. {str(e)}")


# ========================
# LOAD GGUF
# ========================

@router.post("/load-gguf")
async def load_gguf(req: LoadGgufRequest):
    """Load a GGUF model for llama.cpp inference. Works on CPU even while GPU trains."""
    global _chat_model, _gguf_model, _engine_type, _loaded_model_name, _loaded_adapters

    with _chat_lock:
        # Unload existing engine first
        _unload_current_engine()

        try:
            from core.gguf_inference import GgufChatModel
            _gguf_model = GgufChatModel(
                gguf_path=req.gguf_path,
                n_gpu_layers=req.n_gpu_layers,
                n_ctx=req.n_ctx,
            )
            _engine_type = "gguf"
            _loaded_model_name = Path(req.gguf_path).name

            return {
                "status": "ok",
                "model": _loaded_model_name,
                "engine": "gguf",
                "message": f"GGUF model loaded: {_loaded_model_name}",
            }
        except Exception as e:
            _unload_current_engine()
            logger.error(f"Failed to load GGUF model: {e}", exc_info=True)
            raise HTTPException(500, f"Couldn't load this GGUF file. {str(e)}")


# ========================
# LOAD / REMOVE ADAPTERS
# ========================

@router.post("/load-adapter")
async def load_adapter(req: LoadAdapterRequest):
    """Load an additional adapter (up to 5 stacked)."""
    global _chat_model, _loaded_adapters

    if _engine_type == "gguf":
        raise HTTPException(400, "Adapter stacking isn't supported with GGUF models.")

    if _chat_model is None:
        raise HTTPException(400, "No model loaded. Load a model first.")

    if len(_loaded_adapters) >= MAX_ADAPTERS:
        raise HTTPException(
            400,
            f"Maximum {MAX_ADAPTERS} adapters can be loaded at once. "
            "Remove one before adding another."
        )

    with _chat_lock:
        adapter_dir = _extract_adapter(req.adapter_path)
        try:
            _chat_model.swap_adapter(adapter_dir)
            _loaded_adapters.append(req.adapter_path)

            # Read system prompt from adapter metadata (if present)
            adapter_system_prompt = None
            metadata_path = Path(adapter_dir) / "adapter_metadata.json"
            if metadata_path.exists():
                try:
                    meta = json.loads(metadata_path.read_text(encoding="utf-8"))
                    adapter_system_prompt = meta.get("system_prompt")
                except Exception:
                    pass

            return {
                "status": "ok",
                "adapters": _loaded_adapters.copy(),
                "message": f"Adapter loaded ({len(_loaded_adapters)}/{MAX_ADAPTERS})",
                "system_prompt": adapter_system_prompt,
            }
        except Exception as e:
            logger.error(f"Failed to load adapter: {e}", exc_info=True)
            raise HTTPException(500, f"Couldn't load this adapter. {str(e)}")


@router.delete("/adapter/{index}")
async def remove_adapter(index: int):
    """Remove a specific adapter by index. Currently removes all adapters and reloads up to the target."""
    global _chat_model, _loaded_adapters

    if _chat_model is None:
        raise HTTPException(400, "No model loaded.")

    if index < 0 or index >= len(_loaded_adapters):
        raise HTTPException(400, f"Invalid adapter index: {index}. Loaded: {len(_loaded_adapters)}")

    with _chat_lock:
        # Remove the adapter at the given index
        removed = _loaded_adapters.pop(index)

        # To properly remove a specific adapter from a stack, we need to
        # unload all adapters and re-apply the remaining ones
        _chat_model.remove_adapter()

        # Re-apply remaining adapters
        for adapter_path in _loaded_adapters:
            adapter_dir = _extract_adapter(adapter_path)
            _chat_model.swap_adapter(adapter_dir)

        return {
            "status": "ok",
            "removed": removed,
            "adapters": _loaded_adapters.copy(),
            "message": f"Adapter removed. {len(_loaded_adapters)} adapter(s) remaining.",
        }


# ========================
# CHAT MESSAGE (SSE)
# ========================

@router.post("/message")
async def send_message(req: ChatRequest):
    """Send a chat message. Returns SSE stream of tokens."""
    if _engine_type is None:
        raise HTTPException(400, "No model loaded. Load a model first.")

    # GPU busy check only applies to PyTorch (GGUF can run on CPU alongside training)
    if _engine_type == "pytorch" and _is_gpu_busy():
        raise HTTPException(
            409,
            "Your GPU is currently being used for training. "
            "Please wait for training to finish before chatting."
        )

    async def event_stream():
        try:
            if _engine_type == "gguf":
                # GGUF path — true token streaming via llama.cpp
                messages = []
                system_prompt = req.system_prompt
                if system_prompt:
                    messages.append({"role": "system", "content": system_prompt})
                if req.history:
                    messages.extend(req.history)
                messages.append({"role": "user", "content": req.message})

                for token in _gguf_model.chat(
                    messages=messages,
                    temperature=req.temperature,
                    max_tokens=req.max_tokens,
                ):
                    event = ChatStreamEvent(token=token, done=False)
                    yield f"data: {event.model_dump_json()}\n\n"

            else:
                # PyTorch path — generate full response then stream word-by-word
                # Split RAG injection: rules in system prompt, excerpts in user message
                system_prompt = req.system_prompt or ""
                chat_message = req.message
                if _rag_engine and _rag_engine.has_documents():
                    from core.rag import RAGEngine
                    _RAG_CHAR_BUDGET = 12_000
                    _has_adapter = bool(_loaded_adapters)
                    # Append RAG rules to system prompt (adapter-compatible)
                    rag_sys = RAGEngine.get_system_instruction(has_adapter=_has_adapter)
                    system_prompt = system_prompt + "\n\n" + rag_sys if system_prompt else rag_sys
                    # Build user context with budget-aware truncation
                    rag_context = _rag_engine.build_rag_context(req.message, char_budget=_RAG_CHAR_BUDGET, has_adapter=_has_adapter)
                    if rag_context:
                        chat_message = rag_context + "\n\n" + req.message

                response = _chat_model.chat(
                    message=chat_message,
                    system_prompt=system_prompt or None,
                    history=req.history,
                    max_new_tokens=req.max_tokens,
                    temperature=req.temperature,
                )

                words = response.split(" ")
                for i, word in enumerate(words):
                    token = word if i == 0 else " " + word
                    event = ChatStreamEvent(token=token, done=False)
                    yield f"data: {event.model_dump_json()}\n\n"
                    await asyncio.sleep(0.03)  # simulate streaming for PyTorch

            # Send done event
            done_event = ChatStreamEvent(token="", done=True)
            yield f"data: {done_event.model_dump_json()}\n\n"

        except Exception as e:
            logger.error(f"Chat error: {e}", exc_info=True)
            error_event = ChatStreamEvent(
                token="", done=True,
                error="Something went wrong generating a response. Please try again."
            )
            yield f"data: {error_event.model_dump_json()}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ========================
# STATUS
# ========================

@router.get("/status", response_model=ChatStatus)
async def get_chat_status():
    """Return current chat state: loaded model, adapters, engine type."""
    return ChatStatus(
        model=_loaded_model_name,
        adapters=_loaded_adapters.copy(),
        engine=_engine_type,
    )


# ========================
# UNLOAD
# ========================

@router.post("/unload")
async def unload_model():
    """Unload the current model and free memory."""
    with _chat_lock:
        _unload_current_engine()
        _cleanup_rag()

    return {"status": "ok", "message": "Model unloaded, memory freed."}


# ========================
# RAG DOCUMENTS
# ========================

# --- Docling on-demand install ---
_docling_install_lock = threading.Lock()
_docling_installing = False
_docling_install_progress: Optional[str] = None


def _ensure_system_site_packages():
    """Add system Python's site-packages to sys.path if not already present.
    This lets the frozen exe find packages installed on the user's machine."""
    if not getattr(sys, 'frozen', False):
        return  # In dev mode, site-packages are already available
    python_path = shutil.which("python") or shutil.which("python3")
    if not python_path:
        return
    try:
        result = subprocess.run(
            [python_path, "-c", "import site; print('\\n'.join(site.getsitepackages()))"],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            for p in result.stdout.strip().splitlines():
                p = p.strip()
                if p and os.path.isdir(p) and p not in sys.path:
                    sys.path.append(p)
                    logger.info("Added system site-packages to path: %s", p)
    except Exception as e:
        logger.debug("Could not detect system site-packages: %s", e)


def _is_docling_available() -> bool:
    """Check if Docling can be imported — tries current sys.path first,
    then adds system site-packages and retries."""
    try:
        from docling.document_converter import DocumentConverter  # noqa: F401
        return True
    except ImportError:
        pass

    # Maybe it's installed system-wide but sys.path doesn't include it yet
    _ensure_system_site_packages()
    try:
        from docling.document_converter import DocumentConverter  # noqa: F401
        return True
    except ImportError:
        return False


def _get_user_packages_dir() -> str:
    """Get the user packages directory for on-demand installs."""
    base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    pkg_dir = base / "TuneSalonDesktop" / "packages"
    pkg_dir.mkdir(parents=True, exist_ok=True)
    return str(pkg_dir)


@router.get("/documents/docling-status")
async def docling_status():
    """Check if Docling is installed and available."""
    return {
        "installed": _is_docling_available(),
        "installing": _docling_installing,
        "progress": _docling_install_progress,
    }


@router.post("/documents/install-docling")
async def install_docling():
    """Install Docling on-demand into user packages directory."""
    global _docling_installing, _docling_install_progress

    if _docling_installing:
        return {"status": "already_installing", "progress": _docling_install_progress}

    if _is_docling_available():
        return {"status": "already_installed"}

    def _find_pip_command(target: str) -> list:
        """Find a working pip command. Tries system pip first, then embedded Python."""
        # Strategy 1: system pip on PATH
        pip_path = shutil.which("pip") or shutil.which("pip3")
        if pip_path:
            return [pip_path, "install", "docling>=2.0.0", "--target", target, "--quiet"]

        # Strategy 2: system python -m pip
        python_path = shutil.which("python") or shutil.which("python3")
        if python_path:
            return [python_path, "-m", "pip", "install", "docling>=2.0.0", "--target", target, "--quiet"]

        # Strategy 3: bundled embedded Python (PyInstaller _internal/python_embed/)
        if getattr(sys, 'frozen', False):
            bundle_dir = Path(sys._MEIPASS)
            embed_python = bundle_dir / "python_embed" / "python.exe"
            if embed_python.exists():
                return [str(embed_python), "-m", "pip", "install", "docling>=2.0.0", "--target", target, "--quiet"]

        raise RuntimeError("Could not find pip or Python on this system. Please install Python 3.10+ from python.org.")

    def _do_install():
        global _docling_installing, _docling_install_progress
        _docling_installing = True
        _docling_install_progress = "Installing Docling (this may take a few minutes)..."
        try:
            target = _get_user_packages_dir()
            cmd = _find_pip_command(target)
            logger.info("Installing Docling with: %s", " ".join(cmd))

            _flags = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=600, **_flags,
            )

            if result.returncode == 0:
                # Remove torch/torchvision if pip pulled them as dependencies.
                # The system Python already has CUDA-enabled torch — a CPU-only
                # copy in the packages dir would shadow it and break GPU training.
                for pkg_name in ("torch", "torchvision", "torchaudio"):
                    pkg_path = Path(target) / pkg_name
                    if pkg_path.exists():
                        shutil.rmtree(pkg_path, ignore_errors=True)
                        logger.info("Removed %s from packages dir (system CUDA version takes priority)", pkg_name)
                    # Also remove dist-info
                    for di in Path(target).glob(f"{pkg_name}-*.dist-info"):
                        shutil.rmtree(di, ignore_errors=True)

                # Ensure the target is in sys.path
                if target not in sys.path:
                    sys.path.insert(0, target)
                _docling_install_progress = "Docling installed successfully!"
                logger.info("Docling installed to %s", target)
            else:
                err_msg = result.stderr.strip()[-200:] if result.stderr else "Unknown error"
                _docling_install_progress = f"Install failed: {err_msg}"
                logger.error("Docling install failed (exit %d): %s", result.returncode, result.stderr)
        except subprocess.TimeoutExpired:
            _docling_install_progress = "Install timed out. Please try again."
        except RuntimeError as e:
            _docling_install_progress = str(e)
        except Exception as e:
            _docling_install_progress = f"Install error: {str(e)[:200]}"
            logger.error("Docling install error: %s", e, exc_info=True)
        finally:
            _docling_installing = False

    # Run in background thread so the endpoint returns immediately
    thread = threading.Thread(target=_do_install, daemon=True)
    thread.start()
    return {"status": "installing", "progress": _docling_install_progress}


@router.post("/documents/upload")
async def upload_rag_document(file: UploadFile = File(...)):
    """Upload a document for RAG (PDF, DOCX, or TXT)."""
    global _rag_engine, _rag_temp_dir

    if _chat_model is None:
        raise HTTPException(400, "No model loaded. Load a model before uploading documents.")

    # Validate file type
    filename = file.filename or "unknown"
    suffix = Path(filename).suffix.lower().lstrip(".")
    if suffix not in ("pdf", "docx", "txt"):
        raise HTTPException(
            400,
            "Unsupported file type. Please upload a PDF, Word (.docx), or text (.txt) file."
        )

    # PDF requires Docling — check before processing
    if suffix == "pdf" and not _is_docling_available():
        raise HTTPException(
            400,
            "DOCLING_NOT_INSTALLED"
        )

    # Create temp dir for RAG documents if needed
    if _rag_temp_dir is None:
        _rag_temp_dir = tempfile.mkdtemp(prefix="tunesalon_rag_")

    # Save uploaded file
    dest = Path(_rag_temp_dir) / filename
    content = await file.read()
    dest.write_bytes(content)

    # Initialize RAG engine if needed
    if _rag_engine is None:
        from core.rag import RAGEngine
        _rag_engine = RAGEngine()

    try:
        doc_info = _rag_engine.add_document(str(dest), suffix)
        return {
            "status": "ok",
            "filename": doc_info.filename,
            "file_type": doc_info.file_type,
            "pages": doc_info.page_count,
            "chunks": doc_info.chunk_count,
            "characters": doc_info.total_characters,
        }
    except ValueError as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, str(e))
    except Exception as e:
        dest.unlink(missing_ok=True)
        logger.error(f"RAG document upload failed: {e}", exc_info=True)
        raise HTTPException(500, "Couldn't process this document. Please try a different file.")


@router.get("/documents")
async def list_rag_documents():
    """List uploaded RAG documents."""
    if _rag_engine is None:
        return {"documents": []}

    docs = _rag_engine.get_loaded_documents()
    return {
        "documents": [
            {
                "filename": d.filename,
                "file_type": d.file_type,
                "pages": d.page_count,
                "chunks": d.chunk_count,
                "characters": d.total_characters,
            }
            for d in docs
        ]
    }


@router.delete("/documents/{filename:path}")
async def remove_rag_document(filename: str):
    """Remove a RAG document."""
    if _rag_engine is None:
        # Engine already cleaned up (e.g. model was unloaded) — documents are gone
        return {"status": "ok", "message": f"Removed '{filename}'."}

    try:
        _rag_engine.remove_document(filename)

        # Clean up the temp file
        if _rag_temp_dir:
            temp_file = Path(_rag_temp_dir) / filename
            temp_file.unlink(missing_ok=True)

        return {"status": "ok", "message": f"Removed '{filename}'."}
    except ValueError as e:
        raise HTTPException(404, str(e))

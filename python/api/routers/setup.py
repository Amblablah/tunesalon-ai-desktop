"""Setup router — dependency detection and installation for desktop app."""

import json
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

# ---------------------------------------------------------------------------
# App data directory + manifest path
# ---------------------------------------------------------------------------

_APP_DATA_DIR = Path(os.environ.get("APPDATA", Path.home())) / "TuneSalonDesktop"
_MANIFEST_PATH = _APP_DATA_DIR / "deps_manifest.json"

# ---------------------------------------------------------------------------
# Install state (module-level, shared between endpoint calls)
# ---------------------------------------------------------------------------

_install_state: dict = {
    "running": False,
    "current_component": None,
    "progress": {},  # component -> {"status": str, "pct": int}
    "error": None,
}

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class ComponentStatus(BaseModel):
    name: str
    display_name: str
    description: str
    required: bool
    installed: bool
    version: Optional[str] = None
    min_version: Optional[str] = None
    outdated: bool = False
    download_size: Optional[str] = None


class DetectResult(BaseModel):
    gpu_name: Optional[str] = None
    gpu_driver: Optional[str] = None
    components: list[ComponentStatus]
    needs_setup: bool


class InstallRequest(BaseModel):
    components: list[str]


class InstallStatusResponse(BaseModel):
    running: bool
    current_component: Optional[str] = None
    progress: dict
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Detection helpers
# ---------------------------------------------------------------------------


def _find_system_python() -> Optional[str]:
    """Find a Python >= 3.10 on the system PATH."""
    for candidate in ("python", "python3", "py"):
        path = shutil.which(candidate)
        if not path:
            continue
        try:
            result = subprocess.run(
                [path, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            output = (result.stdout + result.stderr).strip()
            # "Python 3.11.2" -> "3.11.2"
            ver_str = output.split()[-1] if output.split() else ""
            tup = _parse_version(ver_str)
            if tup >= (3, 10):
                return path
        except Exception:
            continue
    return None


def _parse_version(ver_str: str) -> tuple:
    """Parse a version string like '2.6.0+cu118' into a numeric tuple (2, 6, 0)."""
    # Strip build metadata after '+' or '-'
    base = ver_str.split("+")[0].split("-")[0]
    parts = []
    for seg in base.split("."):
        try:
            parts.append(int(seg))
        except ValueError:
            break
    return tuple(parts) if parts else (0,)


def _check_python_package(python: str, package: str) -> Optional[str]:
    """Return installed version string for *package*, or None if not found."""
    # Use the package's __version__ attribute; fall back to importlib.metadata
    script = (
        f"try:\n"
        f"    import importlib.metadata as m; print(m.version('{package}'))\n"
        f"except Exception:\n"
        f"    try:\n"
        f"        import {package}; print(getattr({package}, '__version__', 'unknown'))\n"
        f"    except Exception:\n"
        f"        print('NOT_FOUND')\n"
    )
    try:
        result = subprocess.run(
            [python, "-c", script],
            capture_output=True,
            text=True,
            timeout=30,
        )
        output = result.stdout.strip()
        if output and output != "NOT_FOUND":
            return output
    except Exception:
        pass
    return None


def _check_torch_cuda(python: str) -> bool:
    """Return True if torch is installed and CUDA is available."""
    try:
        result = subprocess.run(
            [python, "-c", "import torch; print(torch.cuda.is_available())"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        return result.stdout.strip().lower() == "true"
    except Exception:
        return False


def _detect_gpu() -> tuple[Optional[str], Optional[str]]:
    """Return (gpu_name, driver_version) from nvidia-smi, or (None, None)."""
    nvidia_smi = shutil.which("nvidia-smi")
    if not nvidia_smi:
        return None, None
    try:
        result = subprocess.run(
            [
                nvidia_smi,
                "--query-gpu=name,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        line = result.stdout.strip().splitlines()[0] if result.stdout.strip() else ""
        if "," in line:
            parts = [p.strip() for p in line.split(",", 1)]
            return parts[0] or None, parts[1] or None
    except Exception:
        pass
    return None, None


# ---------------------------------------------------------------------------
# Manifest helpers
# ---------------------------------------------------------------------------


def _load_manifest() -> dict:
    """Load deps_manifest.json; return empty dict if missing or invalid."""
    try:
        if _MANIFEST_PATH.exists():
            return json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_manifest(python: str) -> None:
    """Re-check installed versions and write deps_manifest.json."""
    _APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
    data: dict = {"python_path": python, "components": {}}

    for pkg in ("pip", "torch", "docling", "llama_cpp"):
        ver = _check_python_package(python, pkg)
        if ver:
            data["components"][pkg] = ver

    _MANIFEST_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Installation helpers
# ---------------------------------------------------------------------------

_PIP_COMMANDS: dict[str, list[str]] = {
    "torch": ["install", "torch", "--index-url", "https://download.pytorch.org/whl/cu118"],
    "docling": ["install", "docling"],
    "llama_cpp": ["install", "llama-cpp-python"],
    "pip": ["install", "--upgrade", "pip"],
}


def _pip_install(python: str, component: str) -> bool:
    """
    Run pip for *component*. Updates _install_state in real time.
    Returns True on success, False on failure.
    """
    pip_args = _PIP_COMMANDS.get(component)
    if pip_args is None:
        _install_state["progress"][component] = {"status": "error", "pct": 0}
        return False

    cmd = [python, "-m", "pip"] + pip_args
    _install_state["progress"][component] = {"status": "starting", "pct": 0}

    try:
        _flags = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            **_flags,
        )

        for line in iter(proc.stdout.readline, ""):
            line_lower = line.lower()
            if "downloading" in line_lower:
                _install_state["progress"][component] = {
                    "status": "downloading",
                    "pct": 30,
                }
            elif "installing" in line_lower:
                _install_state["progress"][component] = {
                    "status": "installing",
                    "pct": 80,
                }
            elif "successfully installed" in line_lower:
                _install_state["progress"][component] = {
                    "status": "done",
                    "pct": 100,
                }

        proc.wait(timeout=600)
        if proc.returncode == 0:
            _install_state["progress"][component] = {"status": "done", "pct": 100}
            return True
        else:
            _install_state["progress"][component] = {"status": "error", "pct": 0}
            return False

    except subprocess.TimeoutExpired:
        proc.kill()
        _install_state["progress"][component] = {"status": "timeout", "pct": 0}
        return False
    except Exception as exc:
        _install_state["progress"][component] = {"status": "error", "pct": 0}
        _install_state["error"] = str(exc)
        return False


def _run_installs(components: list[str]) -> None:
    """Background thread: install each component sequentially."""
    global _install_state

    python = _find_system_python()
    if not python:
        _install_state["running"] = False
        _install_state["error"] = "No suitable Python (>=3.10) found on PATH."
        return

    for component in components:
        _install_state["current_component"] = component
        success = _pip_install(python, component)
        if not success:
            # Record error and stop
            if not _install_state["error"]:
                _install_state["error"] = f"Failed to install {component}."
            break

    # Save manifest regardless of partial success
    try:
        _save_manifest(python)
    except Exception:
        pass

    _install_state["running"] = False
    _install_state["current_component"] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/detect", response_model=DetectResult)
async def detect_dependencies() -> DetectResult:
    """Scan system for all required and optional components."""
    global _install_state

    # Reset any stale install state from a previous session
    if not _install_state["running"]:
        _install_state = {
            "running": False,
            "current_component": None,
            "progress": {},
            "error": None,
        }

    gpu_name, gpu_driver = _detect_gpu()
    python = _find_system_python()

    components: list[ComponentStatus] = []

    # --- Python ---
    python_ver: Optional[str] = None
    python_installed = False
    if python:
        try:
            result = subprocess.run(
                [python, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            output = (result.stdout + result.stderr).strip()
            python_ver = output.split()[-1] if output.split() else None
        except Exception:
            pass
        python_installed = True

    python_outdated = False
    if python_ver:
        python_outdated = _parse_version(python_ver) < (3, 10)

    components.append(ComponentStatus(
        name="python",
        display_name="Python",
        description="Core runtime that powers the app",
        required=True,
        installed=python_installed and not python_outdated,
        version=python_ver,
        min_version="3.10",
        outdated=python_outdated,
    ))

    # --- pip ---
    pip_ver: Optional[str] = None
    pip_installed = False
    if python:
        pip_ver = _check_python_package(python, "pip")
        pip_installed = pip_ver is not None

    pip_outdated = False
    if pip_ver:
        pip_outdated = _parse_version(pip_ver) < (21, 0)

    components.append(ComponentStatus(
        name="pip",
        display_name="pip",
        description="Package installer for Python dependencies",
        required=True,
        installed=pip_installed and not pip_outdated,
        version=pip_ver,
        min_version="21.0",
        outdated=pip_outdated,
    ))

    # --- PyTorch + CUDA ---
    torch_ver: Optional[str] = None
    torch_installed = False
    if python:
        torch_ver = _check_python_package(python, "torch")
        if torch_ver:
            has_cuda = _check_torch_cuda(python)
            torch_installed = has_cuda  # only "installed" if CUDA is available

    torch_outdated = False
    if torch_ver:
        # Strip CUDA suffix before version comparison
        torch_outdated = _parse_version(torch_ver) < _parse_version("2.1.0")

    components.append(ComponentStatus(
        name="torch",
        display_name="PyTorch + CUDA",
        description="Enables AI model training and chat on your GPU",
        required=True,
        installed=torch_installed,
        version=torch_ver,
        min_version="2.1.0",
        outdated=torch_outdated,
        download_size="~2.5 GB",
    ))

    # --- Docling ---
    docling_ver: Optional[str] = None
    docling_installed = False
    if python:
        docling_ver = _check_python_package(python, "docling")
        docling_installed = docling_ver is not None

    components.append(ComponentStatus(
        name="docling",
        display_name="Docling",
        description="Lets you upload PDFs and documents for RAG-powered chat",
        required=False,
        installed=docling_installed,
        version=docling_ver,
        download_size="~500 MB",
    ))

    # --- llama-cpp-python ---
    llama_ver: Optional[str] = None
    llama_installed = False
    if python:
        llama_ver = _check_python_package(python, "llama_cpp")
        if llama_ver:
            llama_installed = _parse_version(llama_ver) >= _parse_version("0.2.0")

    llama_outdated = False
    if llama_ver:
        llama_outdated = _parse_version(llama_ver) < _parse_version("0.2.0")

    components.append(ComponentStatus(
        name="llama_cpp",
        display_name="llama-cpp-python",
        description="Run exported GGUF models for faster, lightweight chat",
        required=False,
        installed=llama_installed,
        version=llama_ver,
        min_version="0.2.0",
        outdated=llama_outdated,
        download_size="~100 MB",
    ))

    # needs_setup = any required component is not installed (or outdated)
    needs_setup = any(
        c.required and (not c.installed or c.outdated) for c in components
    )

    return DetectResult(
        gpu_name=gpu_name,
        gpu_driver=gpu_driver,
        components=components,
        needs_setup=needs_setup,
    )


@router.post("/install")
async def install_components(body: InstallRequest) -> dict:
    """Start background installation of the requested components."""
    global _install_state

    if _install_state["running"]:
        return {"started": False, "reason": "Install already in progress."}

    if not body.components:
        return {"started": False, "reason": "No components specified."}

    # Reset state for a fresh run
    _install_state = {
        "running": True,
        "current_component": None,
        "progress": {c: {"status": "queued", "pct": 0} for c in body.components},
        "error": None,
    }

    thread = threading.Thread(
        target=_run_installs,
        args=(body.components,),
        daemon=True,
    )
    thread.start()

    return {"started": True}


@router.get("/status", response_model=InstallStatusResponse)
async def install_status() -> InstallStatusResponse:
    """Return current install progress."""
    return InstallStatusResponse(
        running=_install_state["running"],
        current_component=_install_state.get("current_component"),
        progress=_install_state.get("progress", {}),
        error=_install_state.get("error"),
    )


@router.get("/manifest")
async def get_manifest() -> dict:
    """Read and return the deps manifest from disk."""
    return _load_manifest()

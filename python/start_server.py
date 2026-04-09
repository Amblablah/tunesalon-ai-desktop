"""Entry point for the Python sidecar. Launched by Tauri on app start."""
import os
import sys

# When running as a windowless exe (console=False), stdout/stderr are None.
# Uvicorn's logger crashes calling .isatty() on None. Redirect to devnull.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

# Add user packages dir to sys.path so on-demand pip installs (e.g. Docling) are importable
_user_packages = os.path.join(
    os.environ.get("APPDATA", os.path.join(os.path.expanduser("~"), "AppData", "Roaming")),
    "TuneSalonDesktop", "packages"
)
os.makedirs(_user_packages, exist_ok=True)
if _user_packages not in sys.path:
    sys.path.insert(0, _user_packages)

# In frozen mode, also add system Python's site-packages so the exe can find
# packages already installed on the user's machine (e.g. Docling) without
# needing to install them again.
if getattr(sys, 'frozen', False):
    import subprocess as _sp
    import shutil as _sh
    _py = _sh.which("python") or _sh.which("python3")
    if _py:
        try:
            _result = _sp.run(
                [_py, "-c",
                 "import site, sysconfig; "
                 "print('\\n'.join(site.getsitepackages())); "
                 "print(sysconfig.get_path('stdlib'))"],
                capture_output=True, text=True, timeout=5,
            )
            if _result.returncode == 0:
                for _p in _result.stdout.strip().splitlines():
                    _p = _p.strip()
                    if _p and os.path.isdir(_p) and _p not in sys.path:
                        sys.path.append(_p)
        except Exception:
            pass

# In frozen mode (PyInstaller), transformers' lazy module loader (_LazyModule) can break
# when transformers is bundled inside the exe. In the slim installer, transformers loads
# from system site-packages and works natively — the hack is not needed and can cause
# conflicts. Only run the pre-import fix if transformers is bundled (not from site-packages).
if getattr(sys, 'frozen', False):
    try:
        import torch  # noqa: F401 — test if torch is available
        import transformers
        _tf_path = getattr(transformers, '__file__', '') or ''
        # Only apply hack if transformers is bundled inside the frozen exe
        _exe_dir = os.path.dirname(sys.executable)
        if _exe_dir and _tf_path.startswith(_exe_dir):
            _lazy_attrs = [
                'AutoProcessor', 'ProcessorMixin',
                'AutoFeatureExtractor', 'AutoImageProcessor',
            ]
            for attr in _lazy_attrs:
                try:
                    getattr(transformers, attr)
                except Exception:
                    pass
    except ImportError:
        pass  # torch not installed yet — setup wizard will handle it

import atexit
import uvicorn
from api.main import app


def _cleanup_gguf_subprocess():
    """Kill GGUF server subprocess on exit (atexit handler)."""
    try:
        from api.routers.chat import _gguf_model
        if _gguf_model is not None:
            _gguf_model.unload()
    except Exception:
        pass


atexit.register(_cleanup_gguf_subprocess)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")

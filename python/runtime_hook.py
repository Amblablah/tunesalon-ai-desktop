# PyInstaller runtime hook for TuneSalon Desktop
import os
import sys

# When running as a windowless exe (console=False), stdout/stderr are None.
# Uvicorn's logger crashes calling .isatty() on None. Redirect to log file for debugging.
_log_dir = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "TuneSalonDesktop")
os.makedirs(_log_dir, exist_ok=True)
_log_path = os.path.join(_log_dir, "sidecar.log")
if sys.stdout is None:
    sys.stdout = open(_log_path, "w")
if sys.stderr is None:
    sys.stderr = open(_log_path, "a")

# Note: transformers/peft/trl are NOT bundled in the slim installer.
# They load from system site-packages at runtime (start_server.py adds them).
# Do NOT pre-import transformers modules here — it can poison sys.modules.

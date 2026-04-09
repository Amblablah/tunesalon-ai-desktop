import os
import yaml
from pathlib import Path

_config = None


def get_app_data_dir() -> Path:
    """Get %APPDATA%/TuneSalonDesktop/ — create if missing."""
    base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    app_dir = base / "TuneSalonDesktop"
    app_dir.mkdir(parents=True, exist_ok=True)
    return app_dir


def get_config() -> dict:
    global _config
    if _config is None:
        config_path = Path(__file__).parent.parent / "desktop_config.yaml"
        with open(config_path) as f:
            _config = yaml.safe_load(f)
        # Resolve paths relative to app data dir
        app_dir = get_app_data_dir()
        paths = _config.get("paths", {})
        for key, value in paths.items():
            if key not in ("chat_db", "settings_file"):
                full_path = app_dir / value
                full_path.mkdir(parents=True, exist_ok=True)
                paths[key] = str(full_path)
            else:
                paths[key] = str(app_dir / value)
        _config["paths"] = paths
    return _config


def get_supported_models() -> list:
    return get_config().get("supported_models", [])

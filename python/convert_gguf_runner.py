"""
Standalone GGUF conversion script.
Called by the frozen exe via subprocess with --convert-gguf flag.
Runs the llama.cpp convert_hf_to_gguf.py logic using the frozen exe's own Python environment.
"""
import argparse
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("merged_dir", help="Path to merged model directory")
    parser.add_argument("--outfile", required=True)
    parser.add_argument("--outtype", default="f16")
    args = parser.parse_args()

    # Find the convert script bundled alongside us
    if getattr(sys, 'frozen', False):
        bundle_dir = Path(sys._MEIPASS)
    else:
        bundle_dir = Path(__file__).parent

    convert_script = bundle_dir / "llama_cpp_scripts" / "convert_hf_to_gguf.py"
    if not convert_script.exists():
        # Dev mode fallback
        import yaml
        config_path = Path(__file__).parent / "desktop_config.yaml"
        with open(config_path) as f:
            cfg = yaml.safe_load(f)
        llama_path = cfg.get("gguf_export", {}).get("llama_cpp_path", "llama_cpp")
        convert_script = Path(llama_path) / "convert_hf_to_gguf.py"

    if not convert_script.exists():
        print(f"ERROR: convert_hf_to_gguf.py not found", file=sys.stderr)
        sys.exit(1)

    # Import and run the convert script directly (same Python environment)
    import importlib.util
    spec = importlib.util.spec_from_file_location("convert_hf_to_gguf", str(convert_script))
    # Patch sys.argv so the script sees the right arguments
    sys.argv = [
        str(convert_script),
        args.merged_dir,
        "--outfile", args.outfile,
        "--outtype", args.outtype,
    ]
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)


if __name__ == "__main__":
    main()

# -*- mode: python ; coding: utf-8 -*-
"""
TuneSalon Desktop — PyInstaller spec file.
Bundles Python + FastAPI backend into a standalone folder. PyTorch installed on first launch.
"""

import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# --- Paths ---
SPEC_DIR = SPECPATH
# llama.cpp paths — relative to project root, or set LLAMA_CPP_PATH env var
_LLAMA_CPP_ROOT = Path(os.environ.get('LLAMA_CPP_PATH', os.path.join(SPEC_DIR, '..', 'llama_cpp')))
LLAMA_CPP_BIN = _LLAMA_CPP_ROOT / 'build' / 'bin'
LLAMA_CPP_SCRIPT = _LLAMA_CPP_ROOT / 'convert_hf_to_gguf.py'
PYTHON_EMBED = Path(os.path.join(SPEC_DIR, 'python_embed'))

# --- Data files ---
# desktop_config.yaml must be bundled
datas = [
    (os.path.join(SPEC_DIR, 'desktop_config.yaml'), '.'),
    (os.path.join(SPEC_DIR, 'gguf_server.py'), '.'),
]

# Python embeddable (for running convert_hf_to_gguf.py in frozen mode)
if PYTHON_EMBED.exists():
    for f in PYTHON_EMBED.iterdir():
        datas.append((str(f), 'python_embed'))

# convert_hf_to_gguf.py script from llama.cpp
if LLAMA_CPP_SCRIPT.exists():
    datas.append((str(LLAMA_CPP_SCRIPT), 'llama_cpp_scripts'))
    # Override pip's gguf package with llama.cpp's version (has MistralTokenizerType etc.)
    # The convert script needs llama.cpp's gguf, not the pip one
    llama_gguf_dir = LLAMA_CPP_SCRIPT.parent / 'gguf-py' / 'gguf'
    if llama_gguf_dir.exists():
        datas.append((str(llama_gguf_dir), 'llama_cpp_scripts/gguf'))

# ML packages (transformers, peft, trl, etc.) are NOT bundled.
# They depend on torch which is installed on first launch.
# At runtime, start_server.py adds system site-packages to sys.path
# so these packages are found from the user's Python installation.
# Only bundle data files for packages that DON'T depend on torch.
datas += collect_data_files('tokenizers')
datas += collect_data_files('huggingface_hub')
datas += collect_data_files('pypdf')

# llama-quantize binaries (exe + DLLs)
if LLAMA_CPP_BIN.exists():
    llama_bins = []
    for f in LLAMA_CPP_BIN.iterdir():
        if f.suffix in ('.exe', '.dll'):
            llama_bins.append((str(f), 'llama_cpp_bin'))
    datas += llama_bins

# llama-cpp-python native libraries — NOT bundled.
# Bundling causes DLL conflicts with PyTorch CUDA and crashes on load.
# At runtime, gguf_inference.py adds the system llama_cpp lib path to DLL search.
_llama_cpp_bins = []

# --- Hidden imports ---
# PyTorch internals that PyInstaller misses
hidden_imports = [
    # ML packages (torch, transformers, peft, trl, accelerate, sentence_transformers,
    # faiss, datasets) are NOT bundled. They are loaded from the user's system
    # Python site-packages at runtime (start_server.py adds them to sys.path).
    # Only bundle: API framework, tokenizers, utilities.
    'tokenizers',
    'safetensors',
    # Stdlib modules needed by transformers when loaded from system site-packages
    'filecmp',
    'difflib',
    # Document parsing (Docling installed on-demand, not bundled)
    'pypdf',
    'docx',
    # API
    'fastapi',
    'uvicorn',
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'starlette',
    'starlette.responses',
    'starlette.routing',
    'pydantic',
    'pydantic._internal',
    'multipart',
    'python_multipart',
    # Utilities
    'yaml',
    'aiofiles',
    'aiosqlite',
    'psutil',
    'huggingface_hub',
    'huggingface_hub.hf_api',
    # Numpy (needed by faiss, sentence_transformers)
    'numpy',
    # fpdf2 (PDF export in chat)
    'fpdf',
]

# Collect ALL submodules for tricky packages
hidden_imports += collect_submodules('uvicorn')
hidden_imports += collect_submodules('fastapi')
hidden_imports += collect_submodules('starlette')
# transformers/trl/peft submodules import torch — collected lazily at runtime

# --- Binaries ---
binaries = _llama_cpp_bins

# --- Excludes ---
# Strip modules we don't need to reduce bundle size
excludes = [
    'matplotlib',
    'cv2',
    'IPython',
    'jupyter',
    'notebook',
    'pytest',
    'sphinx',
    'tensorboard',
    'wandb',
    'triton',  # Linux-only, not needed on Windows
    'llama_cpp',  # Loaded from system site-packages (CUDA DLL conflicts with PyTorch)
    # PyTorch + ML ecosystem — loaded from system site-packages at runtime
    'torch',
    'torch.cuda',
    'torch.backends',
    'torch.utils',
    'torch._C',
    'torchvision',
    'torchaudio',
    'transformers',
    'peft',
    'trl',
    'accelerate',
    'datasets',
    'sentence_transformers',
    'faiss',
    'safetensors.torch',
    'scipy',
]

# --- Analysis ---
a = Analysis(
    [os.path.join(SPEC_DIR, 'start_server.py')],
    pathex=[SPEC_DIR],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[os.path.join(SPEC_DIR, 'runtime_hook.py')],
    excludes=excludes,
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='tunesalon',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,  # Don't compress — PyTorch DLLs break with UPX
    console=False,  # Hidden for release — no visible terminal window
    icon=os.path.join(SPEC_DIR, '..', 'src-tauri', 'icons', 'icon.ico'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name='tunesalon',
)

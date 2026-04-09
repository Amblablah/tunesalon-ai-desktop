# TuneSalon AI Desktop

Fine-tune AI models on your own computer. No coding required. Your data stays on your machine.

TuneSalon AI Desktop is an open-source desktop application that lets anyone create custom AI models through fine-tuning. Upload your training data, pick a model, click train, and chat with your custom AI. Everything runs locally on your GPU.


## Features

- Train custom AI adapters on your own data (LoRA fine-tuning)
- Chat with base models or your trained adapters
- Export adapters to GGUF format for lightweight deployment
- Upload documents (PDF, DOCX, TXT) for RAG-powered chat
- Adapter system prompt auto-detection from training data
- Support for multiple adapters stacked simultaneously (up to 5)
- Local model library with folder organization
- Dark mode support
- Works fully offline after initial model download


## Supported Models

All models are permissively licensed (Apache 2.0 or MIT), text-only, and dense:

| Model | Parameters | License | Training VRAM |
|-------|-----------|---------|---------------|
| Qwen/Qwen2.5-1.5B-Instruct | 1.5B | Apache 2.0 | 4 GB |
| microsoft/Phi-4-mini-instruct | 3.8B | MIT | 8 GB |
| Qwen/Qwen3-4B | 4B | Apache 2.0 | 10 GB |
| mistralai/Mistral-7B-Instruct-v0.3 | 7B | Apache 2.0 | 16 GB |
| Qwen/Qwen3-8B | 8B | Apache 2.0 | 14 GB |
| microsoft/phi-4 | 14B | MIT | 22 GB |
| Qwen/Qwen3-14B | 14B | Apache 2.0 | 24 GB |
| mistralai/Mistral-Small-24B-Instruct-2501 | 24B | Apache 2.0 | 40 GB |


## Prerequisites

- Windows 10/11
- Python 3.10 or later
- NVIDIA GPU with CUDA support (RTX 2060 or better recommended)
- CUDA toolkit installed (matching your GPU driver)
- Node.js 18 or later
- Rust and Cargo (for building the Tauri shell)
- PyTorch with CUDA support installed in your system Python

Install PyTorch with CUDA (example for CUDA 13.0):
```
pip install torch --index-url https://download.pytorch.org/whl/cu130
```

Install the ML dependencies:
```
pip install transformers peft trl accelerate datasets safetensors sentence-transformers
```


## Quick Start (Development)

1. Clone the repository:
```
git clone https://github.com/your-username/tunesalon-ai-desktop.git
cd tunesalon-ai-desktop
```

2. Install frontend dependencies:
```
npm install
```

3. Start the Python backend:
```
cd python
python -m uvicorn api.main:app --port 8765 --reload
```

4. In a separate terminal, start the frontend dev server:
```
npm run dev
```

5. Open http://localhost:5173 in your browser, or run the Tauri app:
```
cargo tauri dev
```


## Building the Installer

The full build produces a Windows installer (.exe):

1. Build the frontend:
```
npm run build
```

2. Build the Tauri desktop shell:
```
cargo tauri build
```

3. Build the Python backend sidecar with PyInstaller:
```
cd python
python -m PyInstaller tunesalon.spec --noconfirm
cd ..
```

4. Assemble the distribution:
```
bash build_installer.sh
```

5. Build the NSIS installer:
```
makensis installer.nsi
```

The installer will be created as `TuneSalon-Desktop-0.1.0-setup.exe`.


## GGUF Export

To export trained adapters as GGUF files, you need llama.cpp built locally:

1. Clone and build llama.cpp (see https://github.com/ggerganov/llama.cpp)
2. Set the path in `python/desktop_config.yaml` under `gguf_export.llama_cpp_path`, or set the `LLAMA_CPP_PATH` environment variable


## Project Structure

```
tunesalon-ai-desktop/
├── src/                    React + TypeScript frontend
│   ├── api/                API client modules
│   ├── components/         UI components by feature
│   └── types/              TypeScript interfaces
├── src-tauri/              Tauri desktop shell (Rust)
│   └── src/                Sidecar lifecycle management
├── python/                 Python backend (FastAPI)
│   ├── api/                FastAPI app, routers, schemas, services
│   ├── core/               ML engine (trainer, inference, exporter, RAG)
│   ├── start_server.py     Backend entry point
│   ├── gguf_server.py      GGUF inference subprocess
│   ├── desktop_config.yaml Configuration
│   └── tunesalon.spec      PyInstaller build spec
├── build_installer.sh      Distribution assembly script
├── installer.nsi           NSIS installer configuration
└── docs/                   Documentation
```

### How It Works

The app has three layers:

1. **Tauri shell** (src-tauri/) - Native window, launches the Python backend as a sidecar process
2. **React frontend** (src/) - The UI, communicates with the backend via HTTP on port 8765
3. **Python backend** (python/) - FastAPI server wrapping the core ML modules

The core modules (python/core/) handle:
- `trainer.py` - LoRA fine-tuning with progress callbacks
- `inference.py` - Chat with adapter hot-swapping
- `exporter.py` - GGUF conversion and quantization
- `rag.py` - Document processing and retrieval
- `environment.py` - Hardware detection and caching
- `gpu.py` - Model recommendations based on available VRAM


## Training Data Format

Training data should be JSONL files with the chat messages format:

```json
{"messages": [{"role": "system", "content": "You are a helpful assistant."}, {"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi there!"}]}
```

Each line is one training example. The system prompt is optional but recommended for consistent adapter behavior.


## License

Apache License 2.0. See LICENSE for details.

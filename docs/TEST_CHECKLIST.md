# TuneSalon Desktop — End-to-End Test Checklist

## How to Test

**Option 1: Run the installer**
```
Double-click: TuneSalon-Desktop-0.1.0-setup.exe
```
Installs to `%LOCALAPPDATA%\TuneSalon Desktop\`. Creates Start Menu + Desktop shortcuts.

**Option 2: Run from distribution folder (no install)**
```
cd "installer_dist/TuneSalon Desktop"
"TuneSalon Desktop.exe"
```

**Option 3: Dev mode (existing workflow)**
```
Terminal 1: cd desktop/python && python -m uvicorn api.main:app --port 8765 --reload
Terminal 2: cd desktop && npm run dev
```

---

## Test Checklist

### 1. Installation
- [ ] Installer runs without errors
- [ ] App appears in Start Menu
- [ ] Desktop shortcut created
- [ ] App launches from shortcut

### 2. Startup
- [x] Loading screen shows "Starting backend..." with spinner
- [x] Backend starts within 30 seconds
- [x] Welcome screen shows GPU info (or CPU mode if no GPU)
- [x] Welcome screen shows compatible models
- [x] "Get Started" button works, doesn't show again on relaunch

### 3. System Tab
- [x] GPU name and VRAM displayed correctly
- [ ] CPU, RAM, disk space shown
- [ ] Model compatibility table loads

### 4. Train Tab
- [ ] Model dropdown shows curated models
- [ ] Incompatible models are greyed out
- [ ] Can upload a JSONL dataset
- [ ] Download a small model (Phi-4-mini 3.8B)
- [x] Start training — progress updates appear
- [x] Training completes successfully
- [x] Save adapter — Browse button opens native folder picker (not tkinter)
- [x] Adapter saved to chosen location
- [x] GGUF export works

### 5. Chat Tab
- [ ] Load base model for chat
- [ ] Send a message — response streams token by token
- [ ] Load a trained adapter — response reflects fine-tuning
- [ ] Chat history saves to sidebar
- [ ] Load a GGUF file — inference works on CPU/GPU
- [ ] Multiple chat sessions work

### 6. Library Tab
- [ ] Base Models subtab shows downloaded models
- [ ] Adapters subtab shows saved adapters
- [ ] GGUF subtab shows exported files
- [ ] "+ Download New Model" button works
- [ ] Delete a model/adapter works

### 7. Settings Tab
- [ ] Theme toggle (light/dark/system) works
- [ ] Storage paths displayed correctly
- [ ] Settings persist across app restart

### 8. Error Recovery
- [ ] Kill `tunesalon.exe` while app is running — red banner appears
- [ ] "Restart Backend" button restarts sidecar
- [ ] App recovers and is usable again

### 9. Window Behavior
- [ ] Window resizes correctly (min 900x600)
- [ ] Dark mode respects system preference
- [ ] App closes cleanly (sidecar killed)

### 10. Uninstall
- [ ] Uninstaller runs from Add/Remove Programs
- [ ] Files removed from install directory
- [ ] Shortcuts removed
- [ ] Note: User data in `%APPDATA%/TuneSalonDesktop/` is NOT removed (by design)

---

## Known Limitations
- **First model download is slow** — models are 2-8 GB, downloaded from Hugging Face
- **Bundle size is 2 GB** — PyTorch + CUDA libraries are large, unavoidable for GPU support
- **GGUF convert needs testing** — uses embedded Python to run convert_hf_to_gguf.py; PYTHONPATH setup may need tuning
- **Windows Defender** may flag the installer or exe — PyInstaller bundles are commonly false-positived

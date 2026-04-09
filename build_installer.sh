#!/bin/bash
# TuneSalon Desktop — Assemble final distribution
# Run from the project root directory
set -e

echo "=== TuneSalon Desktop Installer Builder ==="

# Paths
DIST_DIR="installer_dist/TuneSalon Desktop"
TAURI_EXE="src-tauri/target/release/tunesalon-desktop.exe"
SIDECAR_DIR="python/dist/tunesalon"

# Clean previous build
rm -rf installer_dist
mkdir -p "$DIST_DIR"

echo "1. Copying Tauri app..."
cp "$TAURI_EXE" "$DIST_DIR/TuneSalon Desktop.exe"

# Also copy WebView2 loader if present
WV2_LOADER="src-tauri/target/release/WebView2Loader.dll"
if [ -f "$WV2_LOADER" ]; then
    cp "$WV2_LOADER" "$DIST_DIR/"
fi

echo "2. Cleaning phantom dist-info from sidecar..."
rm -rf "$SIDECAR_DIR/_internal/transformers-"*".dist-info"

echo "3. Copying Python sidecar (this takes a moment)..."
cp -r "$SIDECAR_DIR" "$DIST_DIR/python"

echo "4. Verifying..."
if [ -f "$DIST_DIR/TuneSalon Desktop.exe" ] && [ -f "$DIST_DIR/python/tunesalon.exe" ]; then
    echo "   Tauri exe: OK"
    echo "   Python sidecar: OK"
    TOTAL=$(du -sh "$DIST_DIR" | cut -f1)
    echo "   Total size: $TOTAL"
    FILE_COUNT=$(find "$DIST_DIR" -type f | wc -l)
    echo "   File count: $FILE_COUNT"
    echo ""
    echo "=== Distribution ready at: installer_dist/ ==="
    echo ""
    echo "To test:"
    echo "  cd \"installer_dist/TuneSalon Desktop\""
    echo "  ./\"TuneSalon Desktop.exe\""
else
    echo "ERROR: Missing files!"
    exit 1
fi

#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=== Audio Pipeline Setup (no Rust required) ==="
echo ""

echo "[1/4] Installing requests..."
pip install requests

echo "[2/4] Copying scripts..."
cp /sdcard/Download/process_audio.py ~/process_audio.py
cp /sdcard/Download/termux-file-editor "$PREFIX/bin/termux-file-editor"
chmod +x "$PREFIX/bin/termux-file-editor"

echo "[3/4] Verifying ffmpeg..."
ffmpeg -version 2>&1 | head -1

echo "[4/4] Setup complete!"
echo ""
echo "Last step — add your Gemini API key:"
echo "  echo \"export GEMINI_API_KEY='your-key-here'\" >> ~/.bashrc"
echo "  source ~/.bashrc"

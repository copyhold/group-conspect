#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "=== Termux Audio Pipeline Setup ==="
echo ""

# 1. Storage access
echo "[1/6] Granting storage access..."
termux-setup-storage &
sleep 2
echo "      (tap Allow if prompted)"
sleep 3

# 2. Enable external apps (needed for future ADB automation)
echo "[2/6] Enabling allow-external-apps..."
mkdir -p ~/.termux
grep -qxF 'allow-external-apps=true' ~/.termux/termux.properties 2>/dev/null \
  || echo 'allow-external-apps=true' >> ~/.termux/termux.properties

# 3. Install packages
echo "[3/6] Installing packages (pkg update + python + ffmpeg)..."
pkg update -y -o Dpkg::Options::="--force-confnew"
pkg install -y python ffmpeg

# 4. Install Python deps
echo "[4/6] Installing google-generativeai..."
pip install --quiet google-generativeai

# 5. Copy scripts
echo "[5/6] Installing scripts..."
cp ~/storage/downloads/process_audio.py ~/process_audio.py
cp ~/storage/downloads/termux-file-editor "$PREFIX/bin/termux-file-editor"
chmod +x "$PREFIX/bin/termux-file-editor"

# 6. API key
echo "[6/6] Setting up API key..."
if grep -q 'GEMINI_API_KEY' ~/.bashrc 2>/dev/null; then
  echo "      GEMINI_API_KEY already set in ~/.bashrc"
else
  echo ""
  read -rp "      Paste your Gemini API key (get one at aistudio.google.com): " key
  echo "export GEMINI_API_KEY='$key'" >> ~/.bashrc
  echo "      Saved to ~/.bashrc"
fi

source ~/.bashrc

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To use: record audio in Audio Recorder, tap Share -> Termux"
echo "Files will appear in /sdcard/Download/ as *_transcript.txt and *_summary.txt"

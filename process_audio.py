#!/usr/bin/env python3
"""Transcribe and summarize audio recordings via Google Gemini REST API."""

import itertools
import os
import sys
import subprocess
import time
import json
import base64
from pathlib import Path
from datetime import datetime

import requests


GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
MODEL = "gemini-2.5-flash"
# Rough tokens-per-second of audio for estimating transcript progress.
# ~150 wpm speech × (4/3 tokens/word) / 60 ≈ 2.5 t/s; silence/slow speech pulls it lower.
_TOKENS_PER_AUDIO_SEC = 2.0
_android_downloads = Path("/storage/emulated/0/Download")
DOWNLOADS_DIR = Path(os.environ.get(
    "DOWNLOADS_DIR",
    str(_android_downloads) if _android_downloads.parent.exists() else str(Path.home() / "Downloads"),
))
TEMP_DIR = Path(os.environ.get("TMPDIR", "/data/data/com.termux/files/home/tmp"))


def resolve_input(arg: str) -> Path:
    """Resolve file path or content:// URI to a local file."""
    if not arg.startswith("content://"):
        return Path(arg)

    print("Resolving content URI...")
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    temp_file = TEMP_DIR / "shared_audio_input"

    result = subprocess.run(
        ["content", "read", "--uri", arg],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Cannot read content URI: {result.stderr.decode()}")

    temp_file.write_bytes(result.stdout)
    return temp_file


def convert_to_mp3(input_path: Path) -> Path:
    """Convert audio to MP3; return original path if already MP3."""
    if input_path.suffix.lower() == ".mp3":
        return input_path

    mp3_path = TEMP_DIR / (input_path.stem + ".mp3")
    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Converting {input_path.name} -> MP3...")
    result = subprocess.run(
            ["ffmpeg", "-i", str(input_path), "-to","00:20:00","-y", str(mp3_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg error:\n{result.stderr}")

    return mp3_path


def _api(path: str, method: str = "GET", **kwargs):
    """Make a Gemini API request with the API key."""
    sep = "&" if "?" in path else "?"
    url = f"{GEMINI_BASE}/{path}{sep}key={GEMINI_API_KEY}"
    resp = requests.request(method, url, timeout=120, **kwargs)
    resp.raise_for_status()
    return resp


def _api_stream(path: str, label: str = "Generating", total_estimate: int | None = None, **kwargs) -> str:
    """POST to a Gemini streaming endpoint; return concatenated text.

    Prints a live \r progress line: spinner, label, token count, optional %, elapsed.
    total_estimate — expected total output tokens (initial hint; overridden by promptTokenCount
    from the first API chunk, which lets us self-calibrate without needing audio duration).
    Gemini encodes audio at ~32 tokens/sec; output transcript runs at ~_TOKENS_PER_AUDIO_SEC.
    """
    sep = "&" if "?" in path else "?"
    url = f"{GEMINI_BASE}/{path}{sep}key={GEMINI_API_KEY}"
    spinner = itertools.cycle("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏")
    t0 = time.time()
    tokens = 0
    _AUDIO_TOKENS_PER_SEC = 32  # Gemini's audio encoding rate

    with requests.post(url, timeout=(30, 300), stream=True, **kwargs) as resp:
        resp.raise_for_status()
        parts = []
        for raw in resp.iter_lines():
            if not raw:
                continue
            line = raw.decode() if isinstance(raw, bytes) else raw
            if not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if data in ("", "[DONE]"):
                continue
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            try:
                parts.append(chunk["candidates"][0]["content"]["parts"][0]["text"])
            except (KeyError, IndexError):
                pass
            usage = chunk.get("usageMetadata", {})
            tokens = usage.get("candidatesTokenCount", tokens)
            if total_estimate is None:
                prompt_tokens = usage.get("promptTokenCount")
                if prompt_tokens:
                    audio_secs = prompt_tokens / _AUDIO_TOKENS_PER_SEC
                    total_estimate = max(1, int(audio_secs * _TOKENS_PER_AUDIO_SEC))

            elapsed = time.time() - t0
            pct = f" | ~{min(99, round(tokens / total_estimate * 100)):2d}%" if total_estimate else ""
            print(f"\r  {next(spinner)} {label}... {tokens:,} tokens{pct} | {elapsed:.0f}s", end="", flush=True)

        elapsed = time.time() - t0
        print(f"\r  ✓ {label} done — {tokens:,} tokens | {elapsed:.0f}s          ")
        return "".join(parts)


def get_audio_duration(path: Path) -> float | None:
    """Return audio duration in seconds via ffprobe, or None on failure."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=10,
        )
        return float(result.stdout.strip()) if result.returncode == 0 else None
    except Exception:
        return None


def upload_file(mp3_path: Path) -> tuple[str, str]:
    """Upload MP3 via Files API; return (file_uri, file_name)."""
    file_bytes = mp3_path.read_bytes()
    file_size = len(file_bytes)

    print(f"Uploading {mp3_path.name} ({file_size // 1024} KB)...")

    # Start resumable upload — /upload/ prefix required by Google resumable upload protocol
    resp = requests.post(
        f"https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key={GEMINI_API_KEY}",
        headers={
            "X-Goog-Upload-Protocol": "resumable",
            "X-Goog-Upload-Command": "start",
            "X-Goog-Upload-Header-Content-Length": str(file_size),
            "X-Goog-Upload-Header-Content-Type": "audio/mpeg",
            "Content-Type": "application/json",
        },
        json={"file": {"displayName": mp3_path.name}},
        timeout=30,
    )
    resp.raise_for_status()
    upload_url = resp.headers["X-Goog-Upload-URL"]

    # Upload bytes
    resp2 = requests.post(
        upload_url,
        headers={
            "X-Goog-Upload-Command": "upload, finalize",
            "X-Goog-Upload-Offset": "0",
            "Content-Type": "audio/mpeg",
        },
        data=file_bytes,
        timeout=120,
    )
    resp2.raise_for_status()
    info = resp2.json()
    return info["file"]["uri"], info["file"]["name"]


def wait_for_file(file_name: str) -> None:
    """Poll until the uploaded file is ACTIVE."""
    print("Waiting for Gemini to process audio...")
    for _ in range(60):
        resp = _api(file_name)
        state = resp.json().get("state", "")
        if state == "ACTIVE":
            return
        if state == "FAILED":
            raise RuntimeError("Gemini file processing failed")
        time.sleep(2)
    raise RuntimeError("Timed out waiting for file processing")


def delete_file(file_name: str) -> None:
    try:
        _api(file_name, method="DELETE")
    except Exception:
        pass


def generate(prompt: str, file_uri: str, label: str = "Generating", duration_secs: float | None = None) -> str:
    """Call Gemini streamGenerateContent with a text prompt + audio file."""
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"file_data": {"mime_type": "audio/mpeg", "file_uri": file_uri}},
            ]
        }],
        "generationConfig": {"temperature": 0},
    }
    estimate = int(duration_secs * _TOKENS_PER_AUDIO_SEC) if duration_secs else None
    return _api_stream(f"models/{MODEL}:streamGenerateContent?alt=sse", label=label, total_estimate=estimate, json=payload)


def save_outputs(stem: str, transcript: str, summary: str) -> tuple[Path, Path]:
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    t_path = DOWNLOADS_DIR / f"{stem}_{ts}_transcript.txt"
    s_path = DOWNLOADS_DIR / f"{stem}_{ts}_summary.txt"

    t_path.write_text(transcript, encoding="utf-8")
    s_path.write_text(
        f"SUMMARY\n{'=' * 60}\n{summary}\n\n{'=' * 60}\nFULL TRANSCRIPT\n{'=' * 60}\n{transcript}",
        encoding="utf-8",
    )
    return t_path, s_path


def main():
    if not GEMINI_API_KEY:
        sys.exit(
            "Error: GEMINI_API_KEY is not set.\n"
            "Run:  echo \"export GEMINI_API_KEY='your-key-here'\" >> ~/.bashrc\n"
            "Then: source ~/.bashrc"
        )

    if len(sys.argv) < 2:
        sys.exit("Usage: process_audio.py <file-path-or-content-uri>")

    input_path = resolve_input(sys.argv[1])
    stem = input_path.stem

    mp3_path = convert_to_mp3(input_path)
    duration = get_audio_duration(mp3_path)
    if duration:
        mins, secs = divmod(int(duration), 60)
        print(f"Audio duration: {mins}m {secs:02d}s")

    file_uri, file_name = upload_file(mp3_path)

    try:
        wait_for_file(file_name)

        transcript = generate(
            "Transcribe this audio recording accurately. "
            "The audio is in Russian. "
            "If there are multiple speakers, label them as 'Speaker 1:', 'Speaker 2:', etc. "
            "If a word or phrase is unclear, write [неразборчиво] and continue. "
            "Never repeat the same phrase more than twice in a row. "
            "Return only the transcription text, no commentary.",
            file_uri,
            label="Transcribing",
            duration_secs=duration,
        )

        summary = generate(
            "Summarize the following transcript concisely. "
            "Use Markdown formatting with headings and bullet lists. "
            "Cover main topics, key points, and action items. "
            "Write the summary in Russian.\n\n"
            f"Transcript:\n{transcript}",
            file_uri,
            label="Summarizing",
        )
    finally:
        delete_file(file_name)

    t_path, s_path = save_outputs(stem, transcript, summary)

    if mp3_path != input_path and mp3_path.exists():
        mp3_path.unlink()

    print(f"\nDone!")
    print(f"  Transcript : {t_path.name}")
    print(f"  Summary    : {s_path.name}")
    print(f"  Saved to   : {DOWNLOADS_DIR}")


if __name__ == "__main__":
    main()

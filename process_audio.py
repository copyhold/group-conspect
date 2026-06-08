#!/usr/bin/env python3
"""Transcribe and summarize audio recordings via Google Gemini REST API."""

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
DOWNLOADS_DIR = Path("/storage/emulated/0/Download")
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
        ["ffmpeg", "-i", str(input_path), "-y", str(mp3_path)],
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


def _api_stream(path: str, **kwargs) -> str:
    """POST to a Gemini streaming endpoint; return concatenated text."""
    sep = "&" if "?" in path else "?"
    url = f"{GEMINI_BASE}/{path}{sep}key={GEMINI_API_KEY}"
    # stream=True keeps the socket alive; each SSE line arrives as it's generated
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
        return "".join(parts)


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


def generate(prompt: str, file_uri: str) -> str:
    """Call Gemini streamGenerateContent with a text prompt + audio file."""
    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"file_data": {"mime_type": "audio/mpeg", "file_uri": file_uri}},
            ]
        }]
    }
    return _api_stream(f"models/{MODEL}:streamGenerateContent?alt=sse", json=payload)


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
    file_uri, file_name = upload_file(mp3_path)

    try:
        wait_for_file(file_name)

        print("Transcribing...")
        transcript = generate(
            "Transcribe this audio recording accurately. "
            "If there are multiple speakers, label them as 'Speaker 1:', 'Speaker 2:', etc. "
            "Return only the transcription text, no commentary.",
            file_uri,
        )

        print("Summarizing...")
        summary = generate(
            "Summarize the following transcript concisely. "
            "Use Markdown formatting with headings and bullet lists. "
            "Cover main topics, key points, and action items. "
            "Write the summary in Russian.\n\n"
            f"Transcript:\n{transcript}",
            file_uri,
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

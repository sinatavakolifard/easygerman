#!/usr/bin/env python3
"""Flask web UI for the easy-german vocab pipeline.

Upload an audio file, get back the extracted vocabulary table.
Reuses transcribe / extract_vocab / translate from easy_german.py.
"""

from __future__ import annotations

import logging
import tempfile
import time
import uuid
from pathlib import Path

from flask import Flask, redirect, render_template, request, send_from_directory, url_for
from werkzeug.utils import secure_filename

from easy_german import extract_vocab, transcribe, translate

ALLOWED_EXTS = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".mp4", ".webm"}
MODEL_CHOICES = ["tiny", "base", "small", "medium", "large-v3"]

# Uploaded audio is kept here so the result page can play it back.
# Files are swept after UPLOAD_TTL_SECONDS on each new upload.
UPLOAD_DIR = Path(tempfile.gettempdir()) / "easy-german-uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
UPLOAD_TTL_SECONDS = 60 * 60

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")


def _sweep_old_uploads() -> None:
    now = time.time()
    for f in UPLOAD_DIR.iterdir():
        try:
            if now - f.stat().st_mtime > UPLOAD_TTL_SECONDS:
                f.unlink()
        except OSError:
            pass


@app.route("/")
def index():
    return render_template(
        "index.html",
        models=MODEL_CHOICES,
        default_model="small",
        default_min_count=1,
        default_top=50,
    )


@app.route("/process", methods=["POST"])
def process():
    audio = request.files.get("audio")
    if not audio or not audio.filename:
        return redirect(url_for("index"))

    filename = secure_filename(audio.filename)
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTS:
        return render_template(
            "error.html",
            message=f"Unsupported file type '{suffix}'. Allowed: {', '.join(sorted(ALLOWED_EXTS))}",
        ), 400

    model = request.form.get("model", "small")
    if model not in MODEL_CHOICES:
        model = "small"
    try:
        min_count = max(1, int(request.form.get("min_count", "1")))
        top = max(1, int(request.form.get("top", "50")))
    except ValueError:
        min_count, top = 1, 50

    _sweep_old_uploads()
    token = f"{uuid.uuid4().hex}{suffix}"
    saved_path = UPLOAD_DIR / token
    audio.save(saved_path)

    try:
        transcript = transcribe(saved_path, model_size=model)
        vocab = extract_vocab(transcript, min_count=min_count, top_k=top)
        if vocab:
            translate(vocab)
        return render_template(
            "result.html",
            filename=filename,
            vocab=vocab,
            transcript=transcript,
            model=model,
            min_count=min_count,
            top=top,
            audio_url=url_for("audio_file", token=token),
        )
    except Exception as exc:
        logging.exception("Pipeline failed")
        saved_path.unlink(missing_ok=True)
        return render_template("error.html", message=str(exc)), 500


@app.route("/audio/<token>")
def audio_file(token: str):
    # send_from_directory rejects path traversal; tokens are UUID-derived anyway.
    return send_from_directory(UPLOAD_DIR, token, conditional=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)

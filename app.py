#!/usr/bin/env python3
"""Flask web UI for the easy-german vocab pipeline.

Upload an audio file, get back the extracted vocabulary table.
Reuses transcribe / extract_vocab / translate from easy_german.py.
"""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path

from flask import Flask, redirect, render_template, request, url_for
from werkzeug.utils import secure_filename

from easy_german import extract_vocab, transcribe, translate

ALLOWED_EXTS = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".mp4", ".webm"}
MODEL_CHOICES = ["tiny", "base", "small", "medium", "large-v3"]

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")


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

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio.save(tmp.name)
        tmp_path = Path(tmp.name)

    try:
        transcript = transcribe(tmp_path, model_size=model)
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
        )
    except Exception as exc:
        logging.exception("Pipeline failed")
        return render_template("error.html", message=str(exc)), 500
    finally:
        tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001, debug=True)

#!/usr/bin/env python3
"""Flask web UI for the easy-german vocab pipeline.

Each user signs up / logs in with email + password. Extractions are
saved to SQLite (data/easy-german.db) and audio is kept in data/audio/
so the user can revisit past results from /library.
"""

from __future__ import annotations

import logging
import secrets
import sqlite3
import tempfile
import time
import uuid
from functools import wraps
from pathlib import Path

from flask import (
    Flask,
    abort,
    g,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from db import DATA_DIR, connect as db_connect, init_db
from easy_german import Vocab, extract_vocab, transcribe, translate

ALLOWED_EXTS = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".mp4", ".webm"}
MODEL_CHOICES = ["tiny", "base", "small", "medium", "large-v3"]

AUDIO_DIR = DATA_DIR / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# Anonymous (logged-out) uploads go here — kept just long enough to render
# the result and play it back, then swept on the next anon upload.
ANON_AUDIO_DIR = Path(tempfile.gettempdir()) / "easy-german-anon"
ANON_AUDIO_DIR.mkdir(exist_ok=True)
ANON_AUDIO_TTL_SECONDS = 60 * 60

SESSION_TOKEN_PATH = DATA_DIR / "session_token"


def _load_session_token() -> bytes:
    if SESSION_TOKEN_PATH.exists():
        return SESSION_TOKEN_PATH.read_bytes()
    token = secrets.token_bytes(32)
    SESSION_TOKEN_PATH.write_bytes(token)
    SESSION_TOKEN_PATH.chmod(0o600)
    return token


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024  # 500 MB
app.config["SECRET_KEY"] = _load_session_token()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
init_db()


# ─── DB per-request connection ───────────────────────────────────────────


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = db_connect()
    return g.db


@app.teardown_appcontext
def _close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# ─── Auth ────────────────────────────────────────────────────────────────


@app.before_request
def _load_user():
    g.user = None
    user_id = session.get("user_id")
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT id, email FROM users WHERE id = ?", (user_id,)
        ).fetchone()


@app.context_processor
def _inject_user():
    return {"current_user": g.user}


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapper


def _sweep_anon_audio():
    now = time.time()
    for f in ANON_AUDIO_DIR.iterdir():
        try:
            if now - f.stat().st_mtime > ANON_AUDIO_TTL_SECONDS:
                f.unlink()
        except OSError:
            pass


def _safe_next(target):
    # Only allow relative paths that don't try to escape the host.
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return url_for("index")


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if g.user is not None:
        return redirect(url_for("index"))
    error = None
    email = ""
    if request.method == "POST":
        email = (request.form.get("email") or "").strip().lower()
        pw = request.form.get("password") or ""
        if "@" not in email or "." not in email.split("@")[-1] or len(email) > 200:
            error = "Please enter a valid email address."
        elif len(pw) < 8:
            error = "Password must be at least 8 characters."
        else:
            db = get_db()
            try:
                cur = db.execute(
                    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                    (email, generate_password_hash(pw)),
                )
                db.commit()
                session.clear()
                session["user_id"] = cur.lastrowid
                return redirect(url_for("index"))
            except sqlite3.IntegrityError:
                error = "An account with that email already exists."
    return render_template("signup.html", error=error, email=email)


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user is not None:
        return redirect(url_for("index"))
    error = None
    email = ""
    if request.method == "POST":
        email = (request.form.get("email") or "").strip().lower()
        pw = request.form.get("password") or ""
        row = get_db().execute(
            "SELECT id, password_hash FROM users WHERE email = ?", (email,)
        ).fetchone()
        if row and check_password_hash(row["password_hash"], pw):
            session.clear()
            session["user_id"] = row["id"]
            return redirect(_safe_next(request.args.get("next")))
        error = "Invalid email or password."
    return render_template("login.html", error=error, email=email)


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))


# ─── Pipeline + library routes ───────────────────────────────────────────


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
        return (
            render_template(
                "error.html",
                message=f"Unsupported file type '{suffix}'. Allowed: {', '.join(sorted(ALLOWED_EXTS))}",
            ),
            400,
        )

    model = request.form.get("model", "small")
    if model not in MODEL_CHOICES:
        model = "small"
    try:
        min_count = max(1, int(request.form.get("min_count", "1")))
        top = max(1, int(request.form.get("top", "50")))
    except ValueError:
        min_count, top = 1, 50

    token = f"{uuid.uuid4().hex}{suffix}"
    if g.user is None:
        _sweep_anon_audio()
        target_dir = ANON_AUDIO_DIR
    else:
        target_dir = AUDIO_DIR
    saved_path = target_dir / token
    audio.save(saved_path)

    try:
        transcript = transcribe(saved_path, model_size=model)
        vocab = extract_vocab(transcript, min_count=min_count, top_k=top)
        if vocab:
            translate(vocab)
    except Exception as exc:
        logging.exception("Pipeline failed")
        saved_path.unlink(missing_ok=True)
        return render_template("error.html", message=str(exc)), 500

    if g.user is None:
        # Anonymous: render in-place, nothing is persisted.
        return render_template(
            "result.html",
            filename=filename,
            vocab=vocab,
            transcript=transcript,
            model=model,
            min_count=min_count,
            top=top,
            audio_url=url_for("audio_file", token=token),
            anonymous=True,
        )

    db = get_db()
    cur = db.execute(
        """INSERT INTO extractions
              (user_id, filename, audio_token, model, min_count, top_k, transcript)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (g.user["id"], filename, token, model, min_count, top, transcript),
    )
    extraction_id = cur.lastrowid
    db.executemany(
        """INSERT INTO vocab_entries
              (extraction_id, position, lemma, pos, count, article,
               meaning, example, example_translation)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                extraction_id,
                i,
                v.lemma,
                v.pos,
                v.count,
                v.article,
                v.meaning,
                v.example,
                v.example_translation,
            )
            for i, v in enumerate(vocab)
        ],
    )
    db.commit()
    return redirect(url_for("show_extraction", extraction_id=extraction_id))


@app.route("/library")
@login_required
def library():
    rows = get_db().execute(
        """SELECT e.id, e.filename, e.model, e.created_at,
                  (SELECT COUNT(*) FROM vocab_entries v
                   WHERE v.extraction_id = e.id) AS word_count
           FROM extractions e
           WHERE e.user_id = ?
           ORDER BY e.created_at DESC""",
        (g.user["id"],),
    ).fetchall()
    return render_template("library.html", extractions=rows)


@app.route("/extractions/<int:extraction_id>")
@login_required
def show_extraction(extraction_id):
    db = get_db()
    extraction = db.execute(
        "SELECT * FROM extractions WHERE id = ? AND user_id = ?",
        (extraction_id, g.user["id"]),
    ).fetchone()
    if extraction is None:
        abort(404)
    rows = db.execute(
        "SELECT * FROM vocab_entries WHERE extraction_id = ? ORDER BY position",
        (extraction_id,),
    ).fetchall()
    vocab = [
        Vocab(
            lemma=r["lemma"],
            pos=r["pos"],
            count=r["count"],
            zipf=0.0,
            example=r["example"] or "",
            meaning=r["meaning"] or "",
            example_translation=r["example_translation"] or "",
            article=r["article"] or "",
        )
        for r in rows
    ]
    return render_template(
        "result.html",
        filename=extraction["filename"],
        vocab=vocab,
        transcript=extraction["transcript"] or "",
        model=extraction["model"],
        min_count=extraction["min_count"],
        top=extraction["top_k"],
        audio_url=url_for("audio_file", token=extraction["audio_token"]),
    )


@app.route("/audio/<token>")
def audio_file(token):
    # Saved (logged-in) extractions: check ownership in DB.
    row = get_db().execute(
        "SELECT user_id FROM extractions WHERE audio_token = ?", (token,)
    ).fetchone()
    if row is not None:
        if g.user is None or row["user_id"] != g.user["id"]:
            abort(404)
        return send_from_directory(AUDIO_DIR, token, conditional=True)
    # Anonymous uploads: serve from temp dir if still present (UUID-gated).
    if (ANON_AUDIO_DIR / token).exists():
        return send_from_directory(ANON_AUDIO_DIR, token, conditional=True)
    abort(404)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
    # app.run(host="127.0.0.1", port=5001, debug=True)

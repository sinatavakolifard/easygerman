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
    jsonify,
    request,
    send_from_directory,
    session,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

from db import DATA_DIR, connect as db_connect, init_db
from easy_german import (
    DEFAULT_LEVEL,
    DIFFICULTY_LEVELS,
    Vocab,
    extract_vocab,
    transcribe,
    translate,
)

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

# Built React app (vite build output).
FRONTEND_DIST = Path(__file__).resolve().parent / "frontend" / "dist"


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
            return jsonify(error="Authentication required"), 401
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


def _vocab_to_dict(v):
    return {
        "lemma": v.lemma,
        "pos": v.pos,
        "count": v.count,
        "article": v.article,
        "meaning": v.meaning,
        "example": v.example,
        "example_translation": v.example_translation,
        "display": v.display,
    }


# ─── API: /api/me, /api/auth/* ───────────────────────────────────────────


@app.route("/api/config")
def api_config():
    return jsonify(
        models=MODEL_CHOICES,
        default_model="small",
        default_min_count=1,
        default_top=50,
        levels=[{"name": k, "max_zipf": v} for k, v in DIFFICULTY_LEVELS.items()],
        default_level=DEFAULT_LEVEL,
        allowed_extensions=sorted(ALLOWED_EXTS),
    )


@app.route("/api/me")
def api_me():
    if g.user is None:
        return jsonify(user=None)
    return jsonify(user={"id": g.user["id"], "email": g.user["email"]})


@app.route("/api/auth/signup", methods=["POST"])
def api_signup():
    if g.user is not None:
        return jsonify(error="Already logged in"), 400
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    pw = payload.get("password") or ""
    if "@" not in email or "." not in email.split("@")[-1] or len(email) > 200:
        return jsonify(error="Please enter a valid email address."), 400
    if len(pw) < 8:
        return jsonify(error="Password must be at least 8 characters."), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, ?)",
            (email, generate_password_hash(pw)),
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify(error="An account with that email already exists."), 400
    session.clear()
    session["user_id"] = cur.lastrowid
    return jsonify(user={"id": cur.lastrowid, "email": email})


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    if g.user is not None:
        return jsonify(error="Already logged in"), 400
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    pw = payload.get("password") or ""
    row = get_db().execute(
        "SELECT id, email, password_hash FROM users WHERE email = ?", (email,)
    ).fetchone()
    if row is None or not check_password_hash(row["password_hash"], pw):
        return jsonify(error="Invalid email or password."), 401
    session.clear()
    session["user_id"] = row["id"]
    return jsonify(user={"id": row["id"], "email": row["email"]})


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify(ok=True)


# ─── API: pipeline + library ─────────────────────────────────────────────


@app.route("/api/process", methods=["POST"])
def api_process():
    audio = request.files.get("audio")
    if not audio or not audio.filename:
        return jsonify(error="No audio file uploaded"), 400

    filename = secure_filename(audio.filename)
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_EXTS:
        return jsonify(
            error=f"Unsupported file type '{suffix}'. Allowed: {', '.join(sorted(ALLOWED_EXTS))}"
        ), 400

    model = request.form.get("model", "small")
    if model not in MODEL_CHOICES:
        model = "small"
    try:
        min_count = max(1, int(request.form.get("min_count", "1")))
        top = max(0, int(request.form.get("top", "50")))  # 0 = no cap
    except ValueError:
        min_count, top = 1, 50
    level = request.form.get("level", DEFAULT_LEVEL)
    max_zipf = DIFFICULTY_LEVELS.get(level, DIFFICULTY_LEVELS[DEFAULT_LEVEL])

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
        vocab = extract_vocab(
            transcript, min_count=min_count, top_k=top, max_zipf=max_zipf
        )
        if vocab:
            translate(vocab)
    except Exception as exc:
        logging.exception("Pipeline failed")
        saved_path.unlink(missing_ok=True)
        return jsonify(error=str(exc)), 500

    payload = {
        "filename": filename,
        "model": model,
        "min_count": min_count,
        "top_k": top,
        "transcript": transcript,
        "audio_token": token,
        "vocab": [_vocab_to_dict(v) for v in vocab],
    }

    if g.user is None:
        payload["anonymous"] = True
        payload["extraction_id"] = None
        return jsonify(payload)

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
    payload["anonymous"] = False
    payload["extraction_id"] = extraction_id
    payload["created_at"] = db.execute(
        "SELECT created_at FROM extractions WHERE id = ?", (extraction_id,)
    ).fetchone()["created_at"]
    return jsonify(payload)


@app.route("/api/library")
@login_required
def api_library():
    rows = get_db().execute(
        """SELECT e.id, e.filename, e.model, e.created_at,
                  (SELECT COUNT(*) FROM vocab_entries v
                   WHERE v.extraction_id = e.id) AS word_count
           FROM extractions e
           WHERE e.user_id = ?
           ORDER BY e.created_at DESC""",
        (g.user["id"],),
    ).fetchall()
    return jsonify(extractions=[dict(r) for r in rows])


@app.route("/api/extractions/<int:extraction_id>")
@login_required
def api_show_extraction(extraction_id):
    db = get_db()
    extraction = db.execute(
        "SELECT * FROM extractions WHERE id = ? AND user_id = ?",
        (extraction_id, g.user["id"]),
    ).fetchone()
    if extraction is None:
        return jsonify(error="Not found"), 404
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
    return jsonify(
        extraction_id=extraction["id"],
        filename=extraction["filename"],
        model=extraction["model"],
        min_count=extraction["min_count"],
        top_k=extraction["top_k"],
        transcript=extraction["transcript"] or "",
        audio_token=extraction["audio_token"],
        created_at=extraction["created_at"],
        vocab=[_vocab_to_dict(v) for v in vocab],
        anonymous=False,
    )


@app.route("/api/extractions/<int:extraction_id>", methods=["DELETE"])
@login_required
def api_delete_extraction(extraction_id):
    db = get_db()
    row = db.execute(
        "SELECT audio_token FROM extractions WHERE id = ? AND user_id = ?",
        (extraction_id, g.user["id"]),
    ).fetchone()
    if row is None:
        return jsonify(error="Not found"), 404
    # Remove the audio file (best-effort — it may already be gone).
    (AUDIO_DIR / row["audio_token"]).unlink(missing_ok=True)
    # vocab_entries rows are removed via ON DELETE CASCADE.
    db.execute("DELETE FROM extractions WHERE id = ?", (extraction_id,))
    db.commit()
    return jsonify(ok=True)


@app.route("/api/extractions/<int:extraction_id>/reextract", methods=["POST"])
@login_required
def api_reextract(extraction_id):
    db = get_db()
    extraction = db.execute(
        "SELECT * FROM extractions WHERE id = ? AND user_id = ?",
        (extraction_id, g.user["id"]),
    ).fetchone()
    if extraction is None:
        return jsonify(error="Not found"), 404

    transcript = extraction["transcript"] or ""
    if not transcript.strip():
        return jsonify(error="No transcript stored for this extraction"), 400

    payload = request.get_json(silent=True) or {}
    level = payload.get("level", DEFAULT_LEVEL)
    max_zipf = DIFFICULTY_LEVELS.get(level, DIFFICULTY_LEVELS[DEFAULT_LEVEL])
    try:
        min_count = max(1, int(payload.get("min_count", extraction["min_count"])))
        top = max(0, int(payload.get("top", extraction["top_k"])))  # 0 = no cap
    except (ValueError, TypeError):
        min_count = extraction["min_count"]
        top = extraction["top_k"]

    try:
        vocab = extract_vocab(
            transcript, min_count=min_count, top_k=top, max_zipf=max_zipf
        )
        if vocab:
            translate(vocab)
    except Exception as exc:
        logging.exception("Re-extract failed")
        return jsonify(error=str(exc)), 500

    db.execute("DELETE FROM vocab_entries WHERE extraction_id = ?", (extraction_id,))
    db.executemany(
        """INSERT INTO vocab_entries
              (extraction_id, position, lemma, pos, count, article,
               meaning, example, example_translation)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                extraction_id, i, v.lemma, v.pos, v.count, v.article,
                v.meaning, v.example, v.example_translation,
            )
            for i, v in enumerate(vocab)
        ],
    )
    db.execute(
        "UPDATE extractions SET min_count = ?, top_k = ? WHERE id = ?",
        (min_count, top, extraction_id),
    )
    db.commit()
    return api_show_extraction(extraction_id)


# ─── Saved words ────────────────────────────────────────────────────────


@app.route("/api/saved-words", methods=["GET"])
@login_required
def api_saved_words():
    rows = get_db().execute(
        """SELECT id, lemma, pos, article, meaning, example,
                  example_translation, source_filename, saved_at
           FROM saved_words
           WHERE user_id = ?
           ORDER BY saved_at DESC""",
        (g.user["id"],),
    ).fetchall()
    return jsonify(words=[dict(r) for r in rows])


@app.route("/api/saved-words", methods=["POST"])
@login_required
def api_save_word():
    payload = request.get_json(silent=True) or {}
    lemma = (payload.get("lemma") or "").strip()
    pos = (payload.get("pos") or "").strip()
    if not lemma or not pos:
        return jsonify(error="lemma and pos are required"), 400
    db = get_db()
    try:
        cur = db.execute(
            """INSERT INTO saved_words
                  (user_id, lemma, pos, article, meaning, example,
                   example_translation, source_filename)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                g.user["id"],
                lemma,
                pos,
                payload.get("article") or "",
                payload.get("meaning") or "",
                payload.get("example") or "",
                payload.get("example_translation") or "",
                payload.get("source_filename") or "",
            ),
        )
        db.commit()
        return jsonify(id=cur.lastrowid, lemma=lemma, pos=pos), 201
    except sqlite3.IntegrityError:
        row = db.execute(
            "SELECT id FROM saved_words WHERE user_id = ? AND lemma = ? AND pos = ?",
            (g.user["id"], lemma, pos),
        ).fetchone()
        return jsonify(id=row["id"] if row else None, lemma=lemma, pos=pos), 200


@app.route("/api/saved-words/<int:word_id>", methods=["DELETE"])
@login_required
def api_delete_saved_word(word_id):
    db = get_db()
    cur = db.execute(
        "DELETE FROM saved_words WHERE id = ? AND user_id = ?",
        (word_id, g.user["id"]),
    )
    db.commit()
    if cur.rowcount == 0:
        return jsonify(error="Not found"), 404
    return jsonify(ok=True)


# ─── Audio file (binary, kept on the same path the React app expects) ───


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
    if (ANON_AUDIO_DIR / token).exists():
        return send_from_directory(ANON_AUDIO_DIR, token, conditional=True)
    abort(404)


# ─── SPA fallback: serve the React build for everything else ────────────


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa(path):
    if not FRONTEND_DIST.exists():
        return (
            "Frontend has not been built yet. Run "
            "<code>cd frontend && npm install && npm run build</code>, "
            "or use the Vite dev server.",
            503,
        )
    candidate = FRONTEND_DIST / path
    if path and candidate.is_file():
        return send_from_directory(FRONTEND_DIST, path)
    return send_from_directory(FRONTEND_DIST, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
    # app.run(host="127.0.0.1", port=5001, debug=True)

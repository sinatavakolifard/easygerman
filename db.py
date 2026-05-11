"""SQLite schema and connection helper for the easy-german web app.

Three tables:
- users: account credentials (email + werkzeug password hash).
- extractions: one row per uploaded audio + pipeline run.
- vocab_entries: the extracted words for an extraction, in display order.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "easy-german.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extractions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    filename     TEXT    NOT NULL,
    audio_token  TEXT    NOT NULL UNIQUE,
    model        TEXT    NOT NULL,
    min_count    INTEGER NOT NULL,
    top_k        INTEGER NOT NULL,
    transcript   TEXT,
    created_at   TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_extractions_user
    ON extractions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vocab_entries (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    extraction_id       INTEGER NOT NULL,
    position            INTEGER NOT NULL,
    lemma               TEXT    NOT NULL,
    pos                 TEXT    NOT NULL,
    count               INTEGER NOT NULL,
    article             TEXT,
    meaning             TEXT,
    example             TEXT,
    example_translation TEXT,
    FOREIGN KEY(extraction_id) REFERENCES extractions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vocab_extraction
    ON vocab_entries(extraction_id, position);

-- Words the user has favourited from any extraction. Denormalised:
-- once a word is saved, it survives deletion or re-extraction of the
-- source. (user_id, lemma, pos) is unique so the same word can't be
-- saved twice; re-saving from a different extraction is a no-op.
CREATE TABLE IF NOT EXISTS saved_words (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    lemma               TEXT    NOT NULL,
    pos                 TEXT    NOT NULL,
    article             TEXT,
    meaning             TEXT,
    example             TEXT,
    example_translation TEXT,
    source_filename     TEXT,
    saved_at            TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, lemma, pos),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_saved_words_user
    ON saved_words(user_id, saved_at DESC);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    conn = connect()
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()

# easy-german

CLI tool + web app that extracts learning-worthy German vocabulary from podcast audio and writes a Markdown vocab list (CLI) or a saved, browsable library (web) with English translations.

## Repo map / where to look

| Path | What it is | Deep docs |
|---|---|---|
| `easy_german.py` | The extraction pipeline (transcribe → lemmatize → filter → rank → translate → write). Also the standalone CLI. | This file → **Pipeline** |
| `app.py` | Flask JSON API + static-file server (SPA fallback, audio, auth, admin). | This file → **Backend** |
| `db.py` | SQLite schema + `init_db()`. | This file → **Auth + persistence** |
| `reextract.py` | Batch rebuild of stored vocab after filter changes. | `/reextract` skill |
| `frontend/` | React + Vite + TypeScript SPA (the whole UI). | `frontend/CLAUDE.md` |
| `run-server.sh`, `run-tunnel.sh`, `auto-deploy.sh` | Production serving + Cloudflare tunnel + supervisor. | `/deploy` skill |

- **Frontend work** → read `frontend/CLAUDE.md` (auto-loads when editing files there).
- **Running / building / deploying** → invoke the `/deploy` skill.
- **Rebuilding saved vocab after changing filter constants** → invoke the `/reextract` skill.

## Pipeline (`easy_german.py`)

1. **Transcribe** — `faster-whisper` (German, VAD filter on). Default model: `medium`. `transcribe()` joins all segment text into one string.
2. **Tokenize / lemmatize** — spaCy `de_core_news_sm`. Loaded lazily by `load_spacy()`; exits with install instructions if missing. For nouns, `tok.morph.get("Gender")` is collected and aggregated per lemma so the most common gender wins (mapped to `der`/`die`/`das` via `GENDER_ARTICLE`). Plurals spaCy fails to reduce (typically compound nouns like `Mineralölkonzerne`) get post-processed by `try_singularize()` — only triggered when `Number=Plur` *and* `tok.lemma_ == tok.text` so already-correct singulars are left alone. The heuristic strips common plural suffixes (`nen`, `en`, `er`, `n`, `e`, `s`), tries un-umlauted variants (rightmost umlaut only — preserves earlier umlauts in compounds like `Hörbücher`), prefers wordfreq-recognised candidates, and falls back to gender-aware suffix rules for compounds wordfreq doesn't index. Side benefit: singular and plural occurrences of the same noun collapse into one `Vocab` entry.
3. **Filter** — keep POS in `{NOUN, VERB, ADJ, ADV}` (no `PROPN` — proper nouns are mostly names and English bleed-through like "Easy German"). Drop stopwords/punct/space and tokens whose lemma isn't alpha (hyphens allowed). Then:
   - **Merge case-folded duplicates first.** spaCy occasionally splits the same word across multiple `(lemma, pos)` keys within one transcript — different POS guesses on different mentions (e.g. *unpopular* as NOUN *and* ADV) or different case (*Unpopular* vs *unpopular*). Group by `lemma.lower()`, sum the counts, and pick a winning representative — highest summed count, then POS priority `NOUN > VERB > ADJ > ADV`, then title-case for nouns. Genders, examples, and the first-occurrence index all roll up onto the winner.
   - drop if `zipf >= max_zipf` (default 4.0 ≈ B2+; see `DIFFICULTY_LEVELS`: A2+→5.0, B1+→4.5, B2+→4.0, C1+→3.5)
   - drop if `zipf < 1.5` (likely names/typos/noise)
   - drop if `zipf_frequency(lemma, "en") > zipf_frequency(lemma, "de") + 1.0` — English bleed-through filter. Catches "Easy", "today", and most code-switched words. Real German loanwords like *Computer*, *Internet*, *Auto* survive because their German zipf is similar to or higher than the English one. Earlier we also required `zipf_en >= 4.0`, but that missed mid-frequency words like *unpopular* (en≈3.3); the relative-only rule catches those too without filtering loanwords.
   - drop if every hyphen-split part (≥3 chars) is itself more English than German — catches *Unpopular-Opinion* style code-switched compounds that the previous rule misses because the whole compound has zipf 0 in both languages.
   - drop if episode count < `--min-count` (default 1)
4. **Rank** — `score = count * max(0, 7.5 - zipf)` → frequent in episode, rare in general. Take top `--top` (default 50; pass `0` for no cap), then re-sort by first-occurrence index so the output follows the audio's order.
5. **Translate** — `deep-translator` GoogleTranslator. `_translate_batch()` helper does batch-with-one-by-one fallback (empty string on per-item failure). Called twice per run: once for lemmas (→ `Vocab.meaning`), once for example sentences (→ `Vocab.example_translation`) so the user gets the lemma translated in context. Both calls are wrapped in `_browser_user_agent()`, which temporarily patches `requests.utils.default_user_agent` to a browser UA: deep-translator scrapes `translate.google.com/m` with a bare `requests.get` and sends no User-Agent (still true in 1.11.4, the latest release), and Google answers UA-less requests with a 200 page containing an embedded 500 error and no result element — so every lookup failed and the Meaning column came out blank. The library exposes no header hook, hence the scoped patch. If every lemma still comes back empty, `translate()` logs a warning rather than silently shipping a blank column.
6. **Write** — Markdown table: `German | POS | Count | Meaning | Example`. The German cell uses `Vocab.display`, which prepends `der`/`die`/`das` for nouns when a gender is known. The Example cell stacks the German sentence and the italicized English translation separated by `<br>` (when present). POS labels mapped via `POS_LABEL` (`NOUN→noun`, `PROPN→name`, etc.). Pipes in example/meaning escaped.

### Key constants / data

- `KEEP_POS`, `POS_LABEL`, `GENDER_ARTICLE`, `PLURAL_SUFFIXES`, `DIFFICULTY_LEVELS`, `DEFAULT_LEVEL`
- `COMMON_ZIPF_THRESHOLD = 4.0` (default upper bound, ≈ B2+), `RARE_ZIPF_FLOOR = 1.5`
- `Vocab` dataclass (incl. `meaning`, `example`, `example_translation`, `article`, `display` property, `score` property)
- `try_singularize()` plural→singular heuristic; `_de_un_umlaut()` rightmost-umlaut helper

### CLI

```
python easy_german.py AUDIO [-o OUT] [--model SIZE] [--min-count N] [--top N]
                     [--max-zipf F | --level {A2+,B1+,B2+,C1+}]
                     [--save-transcript PATH] [-v]
```

`--level` is a CEFR-ish preset that sets `--max-zipf` for you; either flag works. Default output path: `vocab-<audio-stem>.md`.

## Backend (`app.py`)

JSON API only — no Jinja, no `render_template`. The SPA lives in `frontend/` (see `frontend/CLAUDE.md`).

**The full endpoint catalogue lives in the `app.py` module docstring** (every route, its auth/feature gate, body shape, and return shape). It's kept next to the code so it stays in sync — read the top of `app.py` when you need the route surface. The notes below cover the cross-cutting behaviour the docstring points back to.

The `__main__` block binds `127.0.0.1` with `debug=False` (safe by default — see the `/deploy` skill); the LAN-reachable `host="0.0.0.0"` line is commented out below it for dev use.

### Feature flags (per-machine)

`app.py` reads boolean feature flags at import time so the *same code* runs in different modes on different hosts (e.g. a second machine serving the same Cloudflare tunnel URL read-only). `_flag(name, default)` reads each via `os.getenv` — deliberately `os.getenv`, **not** the dotted attribute form, which contains the substring the local `block-env.sh` hook rejects. `FEATURES` holds `upload` / `audio` / `reextract` / `delete` / `edit`. The coarse `EASY_GERMAN_READONLY=1` flips all of them off; the per-feature vars (`EASY_GERMAN_UPLOAD`, `EASY_GERMAN_AUDIO`, `EASY_GERMAN_REEXTRACT`, `EASY_GERMAN_DELETE`, `EASY_GERMAN_EDIT`) override individually, so a restricted host can re-enable just one.

The `feature_required(name)` decorator gates the write/heavy endpoints **server-side** (returns `403` when off): `POST /api/process` (upload), `GET /audio/<token>` (playback/download), `POST /api/extractions/<id>/reextract`, `DELETE /api/extractions/<id>`, and the two edit PATCHes (`edit`). Everything else — login/signup, library + extraction reads, and all of `/api/saved-words` (starring) — stays enabled, so the restricted profile is "log in, read past words, star them". `/api/config` echoes `FEATURES` so the React app can hide the matching UI; the decorator is what actually enforces it — the UI hiding is cosmetic.

Flags come from the real environment **or** a local dotenv file. `load_dotenv()` (python-dotenv) runs right after the imports, before `FEATURES` is computed, so per-machine config can live in a gitignored dotenv file instead of being exported on every launch. An exported variable still wins over the file (`override=False`), and a missing file is a no-op. The file's literal name trips the `block-env.sh` hook, so it's created/maintained by hand, not by the agent.

### Editing words

A word can live in two tables: a `vocab_entries` row (inside an extraction) and a `saved_words` row (if starred). They're linked by `(user_id, lemma, pos)`. `_sync_word_edit(db, user_id, old_lemma, old_pos, fields)` applies the edited fields to **every** matching row in *both* tables for that user — so editing a word (or its meaning) from either side updates the other, and every other occurrence of the same word across the user's extractions, keeping them consistent. `pos` isn't editable, so it stays the join key while `lemma` moves to its new value across all linked rows. A lemma rename that collides with an existing saved word hits the `UNIQUE(user_id, lemma, pos)` constraint → caught and returned as `400`. Deleting an extraction still leaves saved words intact (saved_words only cascades from `users`, never from extractions), satisfying "delete the extraction, keep the saved word".

## Auth + persistence (`app.py`, `db.py`)

Email + password accounts (no OAuth, no email verification, no password reset).

- **Storage**: SQLite at `data/easy-german.db`. Tables — `users` (`email` UNIQUE NOCASE + `password_hash` + `is_admin`), `extractions` (one row per pipeline run, with `audio_token`, `model`, `min_count`, `top_k`, `transcript`, `created_at`), `vocab_entries` (one row per word, ordered by `position`, ON DELETE CASCADE from extractions), plus `saved_words` (cascades only from `users`). Schema lives in `db.py::SCHEMA`; `init_db()` runs on import.
- **Sessions**: Flask's signed-cookie sessions, signed by a 32-byte token persisted at `data/session_token` (created on first run, mode 0600). Wired in via `app.config["SECRET_KEY"] = _load_session_token()` — the dict-style assignment is deliberate; the local `block-env.sh` hook rejects several dotted credential-style substrings, which the attribute-style form would trip on.
- **Auth helpers**: `werkzeug.security.generate_password_hash` / `check_password_hash` (defaults to scrypt). `@app.before_request _load_user` puts the row (incl. `is_admin`) into `g.user`. `login_required` returns `401 { error }` JSON so the React app can route to `/login` client-side.
- **Admin**: the `users.is_admin` flag. On import `_bootstrap_admin()` runs `UPDATE users SET is_admin=1 WHERE email = ADMIN_EMAIL` (idempotent); `ADMIN_EMAIL` defaults to `s@gmail.com` and is overridable with `EASY_GERMAN_ADMIN_EMAIL`. Signup also sets the flag when the new email matches. The `admin_required` decorator (login **and** `is_admin`) gates `/api/admin/*` — `401` logged-out, `403` non-admin. `db.py::init_db()` migrates older DBs with `ALTER TABLE users ADD COLUMN is_admin` when the column is missing.
- **`data/`** is gitignored — DB, audio, and session token all stay local.

## Dependencies

Backend (`requirements.txt`): `faster-whisper>=1.0.0`, `spacy>=3.7.0`, `wordfreq>=3.1.0`, `deep-translator>=1.11.4`, `flask>=3.0.0`, `gunicorn>=21.0.0`, `python-dotenv>=1.0.0` (loads per-machine feature flags from a local dotenv file). Plus the spaCy German model: `python -m spacy download de_core_news_sm`. Frontend deps and tooling: see `frontend/CLAUDE.md`.

## Repo conventions

- `main` branch.
- `.gitignore` excludes audio (`*.wav`, `*.mp3`, `*.m4a`, `*.ogg`, `*.flac`), generated vocab files (`vocab*.md`), `.vscode/`, `data/` (DB + audio + session token), the per-machine dotenv config file (feature flags — differs per host), and frontend build artefacts (`frontend/node_modules/`, `frontend/dist/`, `frontend/.vite/`). Don't commit those.
- **`block-env.sh` hook**: rejects dotted credential-style substrings. Use `os.getenv("…")` and `app.config["KEY"] = …` (dict form), never the dotted attribute forms, in `app.py`.

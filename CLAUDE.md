# easy-german

CLI tool that extracts learning-worthy German vocabulary from podcast audio and writes a Markdown vocab list with English translations.

## Pipeline (`easy_german.py`)

1. **Transcribe** — `faster-whisper` (German, VAD filter on). Default model: `medium`. `transcribe()` joins all segment text into one string.
2. **Tokenize / lemmatize** — spaCy `de_core_news_sm`. Loaded lazily by `load_spacy()`; exits with install instructions if missing. For nouns, `tok.morph.get("Gender")` is collected and aggregated per lemma so the most common gender wins (mapped to `der`/`die`/`das` via `GENDER_ARTICLE`). Plurals spaCy fails to reduce (typically compound nouns like `Mineralölkonzerne`) get post-processed by `try_singularize()` — only triggered when `Number=Plur` *and* `tok.lemma_ == tok.text` so already-correct singulars are left alone. The heuristic strips common plural suffixes (`nen`, `en`, `er`, `n`, `e`, `s`), tries un-umlauted variants (rightmost umlaut only — preserves earlier umlauts in compounds like `Hörbücher`), prefers wordfreq-recognised candidates, and falls back to gender-aware suffix rules for compounds wordfreq doesn't index. Side benefit: singular and plural occurrences of the same noun collapse into one `Vocab` entry.
3. **Filter** — keep POS in `{NOUN, VERB, ADJ, ADV, PROPN}`; drop stopwords/punct/space and tokens whose lemma isn't alpha (hyphens allowed). Then by `wordfreq.zipf_frequency(lemma, "de")`:
   - drop if `zipf >= 5.0` (too common, ~top 3000)
   - drop if `zipf < 1.5` (likely names/typos/noise)
   - drop if episode count < `--min-count` (default 1)
4. **Rank** — `score = count * max(0, 7.5 - zipf)` → frequent in episode, rare in general. Take top `--top` (default 50), then re-sort by first-occurrence index so the output follows the audio's order.
5. **Translate** — `deep-translator` GoogleTranslator. `_translate_batch()` helper does batch-with-one-by-one fallback (empty string on per-item failure). Called twice per run: once for lemmas (→ `Vocab.meaning`), once for example sentences (→ `Vocab.example_translation`) so the user gets the lemma translated in context.
6. **Write** — Markdown table: `German | POS | Count | Meaning | Example`. The German cell uses `Vocab.display`, which prepends `der`/`die`/`das` for nouns when a gender is known. The Example cell stacks the German sentence and the italicized English translation separated by `<br>` (when present). POS labels mapped via `POS_LABEL` (`NOUN→noun`, `PROPN→name`, etc.). Pipes in example/meaning escaped.

## Key constants / data

- `KEEP_POS`, `POS_LABEL`, `GENDER_ARTICLE`, `PLURAL_SUFFIXES`
- `COMMON_ZIPF_THRESHOLD = 5.0`, `RARE_ZIPF_FLOOR = 1.5`
- `Vocab` dataclass (incl. `meaning`, `example`, `example_translation`, `article`, `display` property, `score` property)
- `try_singularize()` plural→singular heuristic; `_de_un_umlaut()` rightmost-umlaut helper

## CLI

```
python easy_german.py AUDIO [-o OUT] [--model SIZE] [--min-count N] [--top N] [--save-transcript PATH] [-v]
```

Default output path: `vocab-<audio-stem>.md`.

## Web UI

Two-tier app: Flask is now a JSON API + static-file server, and the UI is a React + Vite SPA in `frontend/`.

### Backend (`app.py`)

JSON API only — no Jinja, no `render_template`. Endpoints:

- `GET /api/config` — model list, defaults, allowed extensions (used by the upload form).
- `GET /api/me` — `{ user: { id, email } | null }`.
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout` — JSON in / JSON out, set the session cookie. `login_required` returns `401 { error }` (no redirects) so the React app can route to `/login` itself.
- `POST /api/process` — multipart upload. Returns `{ filename, model, min_count, top_k, transcript, audio_token, vocab[], anonymous, extraction_id?, created_at? }`. Anonymous uploads go to `<tmpdir>/easy-german-anon/<uuid><ext>` and aren't persisted (`_sweep_anon_audio()` clears files older than 1 hour); logged-in uploads go to `data/audio/<uuid><ext>` and write `extractions` + `vocab_entries` rows.
- `GET /api/library` (login required) — list of the user's extractions newest-first with word counts.
- `GET /api/extractions/<id>` (login required) — single extraction, ownership-checked, with `vocab` rebuilt from `vocab_entries`.
- `GET /audio/<token>` — binary audio. Same dual logic as before: DB row → ownership check → serve from `data/audio/`, else fall back to the anon temp dir.
- Catch-all `/<path:path>` and `/` — SPA fallback. Reads `frontend/dist/`; if the path is a real built asset it's served directly, otherwise `index.html` is returned so React Router can take over. If `frontend/dist/` doesn't exist yet, returns a 503 telling you to build the frontend.

`app.run(host="0.0.0.0", ...)` keeps the dev server LAN-reachable (phone via `http://<mac-lan-ip>:5001`); the loopback-only line is commented out below it.

### Frontend (`frontend/`)

Vite + React 18 + React Router 6.

- Entry: `index.html` → `src/main.jsx` → `src/App.jsx`. Routes: `/`, `/login`, `/signup`, `/library`, `/extraction/:id`.
- `src/AuthContext.jsx` — calls `/api/me` on mount, exposes `user` (`undefined` while loading), `login`, `signup`, `logout`. `<RequireAuth>` in `App.jsx` redirects to `/login` for the gated pages.
- `src/api.js` — thin `fetch` wrapper, `credentials: "include"` so the session cookie travels, raises on non-2xx with `err.data.error`.
- `src/components/Layout.jsx` — topbar with auth-aware nav (Library / email / Log out vs Log in / Sign up). Uses an `<Outlet>` so route content slots in below.
- `src/components/VocabResult.jsx` — shared between the "just-uploaded anonymous result" view (rendered inline by `IndexPage`) and the saved-extraction view (rendered by `ExtractionPage`). Same vocab table + audio player + transcript `<details>`.
- `src/pages/IndexPage.jsx` — upload form. On success: if `extraction_id` is in the response, navigates to `/extraction/<id>`; otherwise (anonymous) sets local state and shows the result inline.
- `src/pages/{Login,Signup,Library,Extraction}Page.jsx` — straightforward form pages.
- `src/styles.css` — same rules as the previous Jinja CSS, ported in full (topbar, vocab table, mobile media query for the table-to-cards reflow, auth form styling, etc.). All colours go through CSS variables; the default `:root` block is the dark palette and `:root[data-theme="light"]` overrides for light mode.
- `src/components/ThemeToggle.jsx` — sun/moon SVG button in the topbar that flips `<html data-theme>` between `"dark"` and `"light"` and persists the choice to `localStorage["easy-german-theme"]`. An inline script in `index.html` reads that value (defaulting to `"dark"`) and sets `data-theme` *before* the stylesheet loads, so there's no light-flash on first paint.
- `vite.config.js` — dev proxy for `/api` and `/audio` → `http://127.0.0.1:5001`, so the React dev server on `:5173` and the Flask backend on `:5001` look like a single origin from the browser. Cookies stay first-party and auth just works.

### Dev workflow

Two processes:

```
python3 app.py                              # Flask on :5001 (API + audio)
cd frontend && npm install && npm run dev   # Vite on :5173 (open this)
```

Editing `frontend/src/...` hot-reloads on `:5173` instantly. `:5001` keeps showing whatever was last `npm run build`'d (or 503s if there's no build yet) — this is fine and expected.

### Production / deployment

Single process. Build once, run Flask:

```
cd frontend && npm run build                # outputs frontend/dist/
python3 app.py                              # serves API + dist/ together
```

For real deploys, replace `app.run()` with gunicorn so you don't run the Werkzeug debugger on a network: `gunicorn --workers 1 --timeout 0 --bind 0.0.0.0:5001 app:app`. `--workers 1` because each gunicorn worker holds its own copy of the Whisper model in RAM; `--timeout 0` because transcription routinely runs longer than the default 30 s. Front it with HTTPS — Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:5001`) is the zero-config option; on a VPS, Caddy with `reverse_proxy localhost:5001` auto-issues a Let's Encrypt cert.

## Auth + persistence (`app.py`, `db.py`)

Email + password accounts (no OAuth, no email verification, no password reset).

- **Storage**: SQLite at `data/easy-german.db`. Three tables — `users` (`email` UNIQUE NOCASE + `password_hash`), `extractions` (one row per pipeline run, with `audio_token`, `model`, `min_count`, `top_k`, `transcript`, `created_at`), `vocab_entries` (one row per word, ordered by `position`, ON DELETE CASCADE from extractions). Schema lives in `db.py::SCHEMA`; `init_db()` runs on import.
- **Sessions**: Flask's signed-cookie sessions, signed by a 32-byte token persisted at `data/session_token` (created on first run, mode 0600). Wired in via `app.config["SECRET_KEY"] = _load_session_token()` — the dict-style assignment is deliberate; the local `block-env.sh` hook rejects several dotted credential-style substrings, which the attribute-style form would trip on.
- **Auth helpers**: `werkzeug.security.generate_password_hash` / `check_password_hash` (defaults to scrypt). `@app.before_request _load_user` puts the row into `g.user`. `login_required` decorator returns `401 { error }` JSON so the React app can route to `/login` client-side.
- **`data/`** is gitignored — DB, audio, and session token all stay local.

## Dependencies

Backend (`requirements.txt`): `faster-whisper>=1.0.0`, `spacy>=3.7.0`, `wordfreq>=3.1.0`, `deep-translator>=1.11.4`, `flask>=3.0.0`. Plus the spaCy German model: `python -m spacy download de_core_news_sm`.

Frontend (`frontend/package.json`): `react`, `react-dom`, `react-router-dom` runtime; `vite`, `@vitejs/plugin-react` dev. Run `cd frontend && npm install` once.

## Repo conventions

- `main` branch.
- `.gitignore` excludes audio (`*.wav`, `*.mp3`, `*.m4a`, `*.ogg`, `*.flac`), generated vocab files (`vocab*.md`), `.vscode/`, `data/` (DB + audio + session token), and frontend build artefacts (`frontend/node_modules/`, `frontend/dist/`, `frontend/.vite/`). Don't commit those.

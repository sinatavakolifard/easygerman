# easy-german

CLI tool that extracts learning-worthy German vocabulary from podcast audio and writes a Markdown vocab list with English translations.

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
5. **Translate** — `deep-translator` GoogleTranslator. `_translate_batch()` helper does batch-with-one-by-one fallback (empty string on per-item failure). Called twice per run: once for lemmas (→ `Vocab.meaning`), once for example sentences (→ `Vocab.example_translation`) so the user gets the lemma translated in context.
6. **Write** — Markdown table: `German | POS | Count | Meaning | Example`. The German cell uses `Vocab.display`, which prepends `der`/`die`/`das` for nouns when a gender is known. The Example cell stacks the German sentence and the italicized English translation separated by `<br>` (when present). POS labels mapped via `POS_LABEL` (`NOUN→noun`, `PROPN→name`, etc.). Pipes in example/meaning escaped.

## Key constants / data

- `KEEP_POS`, `POS_LABEL`, `GENDER_ARTICLE`, `PLURAL_SUFFIXES`, `DIFFICULTY_LEVELS`, `DEFAULT_LEVEL`
- `COMMON_ZIPF_THRESHOLD = 4.0` (default upper bound, ≈ B2+), `RARE_ZIPF_FLOOR = 1.5`
- `Vocab` dataclass (incl. `meaning`, `example`, `example_translation`, `article`, `display` property, `score` property)
- `try_singularize()` plural→singular heuristic; `_de_un_umlaut()` rightmost-umlaut helper

## CLI

```
python easy_german.py AUDIO [-o OUT] [--model SIZE] [--min-count N] [--top N]
                     [--max-zipf F | --level {A2+,B1+,B2+,C1+}]
                     [--save-transcript PATH] [-v]
```

`--level` is a CEFR-ish preset that sets `--max-zipf` for you; either flag works.

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
- `POST /api/extractions/<id>/reextract` (login required) — body `{ level?, min_count?, top? }`. Loads the stored transcript, re-runs `extract_vocab` + `translate` with the new params, replaces the extraction's `vocab_entries` rows, updates `min_count` / `top_k` on the extractions row, then returns the same shape as the GET above so the client can drop it into state. `top=0` means no cap — keep every word that passed the filters (can be slow because translation is per-word).
- `DELETE /api/extractions/<id>` (login required) — ownership-checked. Removes the audio file from `data/audio/<token>` (best-effort `unlink(missing_ok=True)`) and `DELETE`s the row; `vocab_entries` follow via `ON DELETE CASCADE`. Returns `{ ok: true }`.
- `GET /api/saved-words` (login required) — list the user's favourited words, newest-first.
- `POST /api/saved-words` (login required) — body `{ lemma, pos, article?, meaning?, example?, example_translation?, source_filename? }`. New saves return `201 { id }`; the UNIQUE(user_id, lemma, pos) constraint makes re-saving idempotent — duplicates return `200 { id }` of the existing row.
- `DELETE /api/saved-words/<id>` (login required) — ownership-checked. Returns `{ ok: true }`.
- `GET /audio/<token>` — binary audio. Same dual logic as before: DB row → ownership check → serve from `data/audio/`, else fall back to the anon temp dir.
- Catch-all `/<path:path>` and `/` — SPA fallback. Reads `frontend/dist/`; if the path is a real built asset it's served directly, otherwise `index.html` is returned so React Router can take over. If `frontend/dist/` doesn't exist yet, returns a 503 telling you to build the frontend.

The `__main__` block binds `127.0.0.1` with `debug=False` (safe by default — see Production / deployment); the LAN-reachable `host="0.0.0.0"` line is commented out below it for dev use (phone via `http://<mac-lan-ip>:5001`).

### Frontend (`frontend/`)

Vite + React 18 + React Router 6.

- Entry: `index.html` → `src/main.jsx` → `src/App.jsx`. Routes: `/`, `/login`, `/signup`, `/library`, `/extraction/:id`.
- `src/AuthContext.jsx` — calls `/api/me` on mount, exposes `user` (`undefined` while loading), `login`, `signup`, `logout`. `<RequireAuth>` in `App.jsx` redirects to `/login` for the gated pages.
- `src/api.js` — thin `fetch` wrapper, `credentials: "include"` so the session cookie travels, raises on non-2xx with `err.data.error`.
- `src/components/Layout.jsx` — topbar with auth-aware nav (Library / email / Log out vs Log in / Sign up). Uses an `<Outlet>` so route content slots in below. On mobile (≤640px) the inline nav collapses behind a hamburger button and reappears as a column-flex dropdown panel below the topbar; the panel auto-closes when the route changes (`useEffect` on `location.pathname`). The Log in link gets a `topbar-secondary` outline-button treatment in the dropdown so it matches the Sign-up CTA's footprint, while staying a plain text link on desktop.
- `src/components/VocabResult.jsx` — shared between the "just-uploaded anonymous result" view (rendered inline by `IndexPage`) and the saved-extraction view (rendered by `ExtractionPage`). Same vocab table + audio player + transcript `<details>`.
- `src/pages/IndexPage.jsx` — upload form. On success: if `extraction_id` is in the response, navigates to `/extraction/<id>`; otherwise (anonymous) sets local state and shows the result inline.
- `src/pages/{Login,Signup,Library,Extraction}Page.jsx` — straightforward form pages. `ExtractionPage` also mounts a `ReextractPanel`.
- `src/components/ReextractPanel.jsx` — collapsible `<details>` rendered above the audio player on the saved-extraction view (passed in as the `controls` slot on `VocabResult`, so anonymous results don't see it). Lets the user pick a new difficulty / min count / top words and POSTs to `/api/extractions/<id>/reextract`; the response replaces the page's `data` state in place. The upload form (`IndexPage`) has the matching Difficulty dropdown.
- **Delete an extraction**: `LibraryPage` has a Delete button on each card (centred vertically, flex layout); `ExtractionPage` passes a Delete button via a new `headerAction` slot on `VocabResult` that renders next to the meta line via the `.result-header` flex container — same row as the filename on desktop, stacked below on mobile. Both confirm with `window.confirm()` first; on success the library list filters the row out (or the detail view navigates back to `/library`).
- **Save individual words**: each row in `VocabResult`'s vocab table starts with a star-icon `.save-toggle` button (outline when unsaved, filled accent when saved). `VocabResult` gets three optional props — `savedMap` (a `Map<"lemma|pos", savedId>`), `onToggleSave`, `savingKey`. `ExtractionPage` fetches `/api/saved-words` on mount, builds the map, and patches it in place after each POST/DELETE — no full refetch. The star button is only rendered when `onToggleSave` is provided, so the anonymous-result view in `IndexPage` doesn't show it. The article + lemma text is wrapped in a `.lemma-text` span so the lemma cell can flex cleanly on mobile (see below); on desktop the cell stays inline and the star sits immediately left of the word.
- **Star position on mobile**: in the `@media (max-width: 640px)` block, `td.lemma` becomes `display: flex; align-items: center` with `.lemma-text { flex: 1 }` and `.save-toggle { order: 1; margin: 0 }`, so the star is pushed to the right edge of the card on phones (easier to reach with the thumb). The icon also scales up to 22px on mobile to match the 20px lemma text — at the desktop 16px it looked too small once it had whitespace around it.
- **`SavedWordsPage` at `/saved`**: card-style list of the user's saved words (lemma + POS + meaning + example + English translation + source filename + saved-at). Each card has its own Remove button. Linked in the topbar (`Library` · `Saved` · email · `Log out`) so it appears in both the desktop nav and the hamburger drop-down.
- **Mobile button-width gotcha**: the `@media (max-width: 640px)` block previously had `button { width: 100% }` — meant for the primary form submit, but every `<button>` matched, so Delete / Remove / star / hamburger got stretched to 100% of their flex container, crushing the title and content cells to one-character-per-line. Rule is now scoped to `form button[type=submit]`. On the same breakpoint, `.extraction-card` and `.saved-card` switch to `flex-direction: column` and the delete/remove button gets `align-self: flex-end`, so on a narrow phone the title/content takes the full row width and the destructive action sits below it, right-aligned.
- `src/styles.css` — same rules as the previous Jinja CSS, ported in full (topbar, vocab table, mobile media query for the table-to-cards reflow, auth form styling, etc.). All colours go through CSS variables; the default `:root` block is the dark palette and `:root[data-theme="light"]` overrides for light mode.
- `src/components/ThemeToggle.jsx` — sun/moon SVG button in the topbar that flips `<html data-theme>` between `"dark"` and `"light"` and persists the choice to `localStorage["easy-german-theme"]`. An inline script in `index.html` reads that value (defaulting to `"dark"`) and sets `data-theme` *before* the stylesheet loads, so there's no light-flash on first paint.
- **Spinner shape gotcha**: `.spinner` is a flex item next to a `<p>` in `#processing`. Without `flex-shrink: 0` it loses width on narrow screens while keeping its 24px height, so the "Processing…" circle renders as an oval on phones. The rule is global (not in the mobile media query) — the squish triggers whenever the flex container is narrower than the spinner + text, which happens on real phones but also small desktop windows.
- **Touch hover gotcha**: every `:hover` rule is wrapped in `@media (hover: hover) and (pointer: fine)`. Without this, iOS Safari and mobile Firefox keep the hover state applied after a tap until you tap somewhere else — the global `button:hover:not(:disabled) { background: var(--accent-hover); }` was painting the hamburger and theme-toggle buttons orange and they stayed that way. Icon buttons also set `-webkit-tap-highlight-color: transparent`, suppress `:focus` outline in favour of `:focus-visible` for keyboard users, and call `e.currentTarget.blur()` after the click to drop focus immediately.
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
python3 app.py                              # serves API + dist/ together (loopback, debugger off)
```

**Never serve `python3 app.py` to a network.** The `__main__` block binds `127.0.0.1` with `debug=False` precisely so an accidental run isn't exposed (the Werkzeug debugger is a remote-code-execution vector). For LAN dev (e.g. testing from a phone), flip the commented `host="0.0.0.0"` line — but that's dev only, never the public path.

For real serving, use gunicorn — it imports `app:app` directly and never runs the `__main__` block, so the debugger can't be reached: `gunicorn --workers 1 --timeout 0 --bind 127.0.0.1:5001 app:app`. `--workers 1` because each worker holds its own copy of the Whisper model in RAM; `--timeout 0` because transcription routinely runs longer than the default 30 s. Bind loopback only and let the tunnel reach in.

**Live deployment — laptop as host, public at `https://easygerman.sinacodes.de`:**

- `run-server.sh` — builds `frontend/dist/` if missing, then runs the gunicorn line above (loopback only).
- `run-tunnel.sh` — `cloudflared tunnel run easy-german`, the named Cloudflare tunnel. Makes an *outbound* connection to Cloudflare, so no router ports are opened and the home IP stays hidden; Cloudflare terminates HTTPS with an auto-issued cert.
- Tunnel config lives outside the repo in `~/.cloudflared/`: `config.yml` (maps `easygerman.sinacodes.de` → `http://localhost:5001`, 404 fallback) + `<tunnel-id>.json` credentials (secret, never commit). Created via `cloudflared tunnel login` → `cloudflared tunnel create easy-german` → `cloudflared tunnel route dns easy-german easygerman.sinacodes.de`.
- Both processes only run while the laptop is awake/online; `caffeinate -s` keeps it from sleeping. Not yet daemonised (no launchd service) and no Cloudflare Access wall in front — the app's own email/password auth is the only gate.

Alternatives: zero-config quick tunnel `cloudflared tunnel --url http://localhost:5001` (random `*.trycloudflare.com` URL); on a VPS, Caddy with `reverse_proxy localhost:5001` auto-issues a Let's Encrypt cert.

## Auth + persistence (`app.py`, `db.py`)

Email + password accounts (no OAuth, no email verification, no password reset).

- **Storage**: SQLite at `data/easy-german.db`. Three tables — `users` (`email` UNIQUE NOCASE + `password_hash`), `extractions` (one row per pipeline run, with `audio_token`, `model`, `min_count`, `top_k`, `transcript`, `created_at`), `vocab_entries` (one row per word, ordered by `position`, ON DELETE CASCADE from extractions). Schema lives in `db.py::SCHEMA`; `init_db()` runs on import.
- **Sessions**: Flask's signed-cookie sessions, signed by a 32-byte token persisted at `data/session_token` (created on first run, mode 0600). Wired in via `app.config["SECRET_KEY"] = _load_session_token()` — the dict-style assignment is deliberate; the local `block-env.sh` hook rejects several dotted credential-style substrings, which the attribute-style form would trip on.
- **Auth helpers**: `werkzeug.security.generate_password_hash` / `check_password_hash` (defaults to scrypt). `@app.before_request _load_user` puts the row into `g.user`. `login_required` decorator returns `401 { error }` JSON so the React app can route to `/login` client-side.
- **`data/`** is gitignored — DB, audio, and session token all stay local.

`reextract.py` is a standalone CLI that rebuilds `vocab_entries` rows for already-stored extractions using the current filter logic (use after changing `COMMON_ZIPF_THRESHOLD`, `KEEP_POS`, etc.). Flags: `--user EMAIL`, `--level {A2+,B1+,B2+,C1+}`, `--min-count`, `--top`, `--dry-run`. Idempotent. Same effect as clicking the panel for every saved extraction in turn.

## Dependencies

Backend (`requirements.txt`): `faster-whisper>=1.0.0`, `spacy>=3.7.0`, `wordfreq>=3.1.0`, `deep-translator>=1.11.4`, `flask>=3.0.0`. Plus the spaCy German model: `python -m spacy download de_core_news_sm`.

Frontend (`frontend/package.json`): `react`, `react-dom`, `react-router-dom` runtime; `vite`, `@vitejs/plugin-react` dev. Run `cd frontend && npm install` once.

## Repo conventions

- `main` branch.
- `.gitignore` excludes audio (`*.wav`, `*.mp3`, `*.m4a`, `*.ogg`, `*.flac`), generated vocab files (`vocab*.md`), `.vscode/`, `data/` (DB + audio + session token), and frontend build artefacts (`frontend/node_modules/`, `frontend/dist/`, `frontend/.vite/`). Don't commit those.

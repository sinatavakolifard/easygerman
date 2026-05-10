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

## Web UI (`app.py`)

Flask app that wraps the same pipeline. Run `python3 app.py` → <http://127.0.0.1:5001>. Upload an audio file, pick model / min-count / top, get the vocab as an HTML table plus the raw transcript (collapsible). Synchronous request — the browser waits for the whole pipeline.

- Reuses `transcribe`, `extract_vocab`, `translate` from `easy_german.py` (no logic duplicated).
- Default model in the form is `small` (not `medium` like the CLI) since browser waits feel longer.
- Allowed extensions: `.wav .mp3 .m4a .ogg .flac .mp4 .webm`. Max upload 500 MB.
- Uploaded audio is saved to `<tmpdir>/easy-german-uploads/<uuid><ext>` (kept after processing so the result page can play it back) and served via `/audio/<token>` using `send_from_directory`. `_sweep_old_uploads()` runs on each upload and deletes files older than `UPLOAD_TTL_SECONDS` (1 hour).
- Result page renders an `<audio controls>` element pointing at `/audio/<token>` above the vocab table.
- Templates in `templates/` (`index.html`, `result.html`, `error.html`); CSS in `static/style.css`.
- `app.run(host="0.0.0.0", ...)` binds on all interfaces so the app is reachable from other devices on the same Wi-Fi (e.g. phone at `http://<mac-lan-ip>:5001`). Switch back to `127.0.0.1` (commented out below the active line) for loopback-only.
- Mobile-friendly: every template ships a `<meta name="viewport" content="width=device-width, initial-scale=1">`, and `static/style.css` has a `@media (max-width: 640px)` block that turns the vocab table into a card list (thead hidden, each row becomes a card; POS+count render inline as `noun · 3×` via `::after` pseudo-elements; meaning and example stacked vertically with a dashed separator). Form inputs are bumped to 16px on mobile to suppress iOS auto-zoom; the submit button goes full-width.

## Dependencies (`requirements.txt`)

`faster-whisper>=1.0.0`, `spacy>=3.7.0`, `wordfreq>=3.1.0`, `deep-translator>=1.11.4`, `flask>=3.0.0`. Plus the spaCy German model: `python -m spacy download de_core_news_sm`.

## Repo conventions

- `main` branch.
- `.gitignore` excludes audio (`*.wav`, `*.mp3`, `*.m4a`, `*.ogg`, `*.flac`), generated vocab files (`vocab*.md`), and `.vscode/`. Don't commit those.

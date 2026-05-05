# easy-german

CLI tool that extracts learning-worthy German vocabulary from podcast audio and writes a Markdown vocab list with English translations.

## Pipeline (`easy_german.py`)

1. **Transcribe** — `faster-whisper` (German, VAD filter on). Default model: `medium`. `transcribe()` joins all segment text into one string.
2. **Tokenize / lemmatize** — spaCy `de_core_news_sm`. Loaded lazily by `load_spacy()`; exits with install instructions if missing.
3. **Filter** — keep POS in `{NOUN, VERB, ADJ, ADV, PROPN}`; drop stopwords/punct/space and tokens whose lemma isn't alpha (hyphens allowed). Then by `wordfreq.zipf_frequency(lemma, "de")`:
   - drop if `zipf >= 5.0` (too common, ~top 3000)
   - drop if `zipf < 1.5` (likely names/typos/noise)
   - drop if episode count < `--min-count` (default 1)
4. **Rank** — `score = count * max(0, 7.5 - zipf)` → frequent in episode, rare in general. Take top `--top` (default 50), then re-sort by first-occurrence index so the output follows the audio's order.
5. **Translate** — `deep-translator` GoogleTranslator. `_translate_batch()` helper does batch-with-one-by-one fallback (empty string on per-item failure). Called twice per run: once for lemmas (→ `Vocab.meaning`), once for example sentences (→ `Vocab.example_translation`) so the user gets the lemma translated in context.
6. **Write** — Markdown table: `German | POS | Count | Meaning | Example`. The Example cell stacks the German sentence and the italicized English translation separated by `<br>` (when present). POS labels mapped via `POS_LABEL` (`NOUN→noun`, `PROPN→name`, etc.). Pipes in example/meaning escaped.

## Key constants / data

- `KEEP_POS`, `POS_LABEL` — line 28-29
- `COMMON_ZIPF_THRESHOLD = 5.0`, `RARE_ZIPF_FLOOR = 1.5` — line 34, 37
- `Vocab` dataclass (incl. `meaning`, `example`, `example_translation`, `score` property) — line 40

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

## Dependencies (`requirements.txt`)

`faster-whisper>=1.0.0`, `spacy>=3.7.0`, `wordfreq>=3.1.0`, `deep-translator>=1.11.4`, `flask>=3.0.0`. Plus the spaCy German model: `python -m spacy download de_core_news_sm`.

## Repo conventions

- `main` branch.
- `.gitignore` excludes audio (`*.wav`, `*.mp3`, `*.m4a`, `*.ogg`, `*.flac`), generated vocab files (`vocab*.md`), and `.vscode/`. Don't commit those.

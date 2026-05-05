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
5. **Translate** — `deep-translator` GoogleTranslator, batch with one-by-one fallback on failure (empty string on per-item failure).
6. **Write** — Markdown table: `German | POS | Count | Meaning | Example`. POS labels mapped via `POS_LABEL` (`NOUN→noun`, `PROPN→name`, etc.). Pipes in example/meaning escaped.

## Key constants / data

- `KEEP_POS`, `POS_LABEL` — line 28-29
- `COMMON_ZIPF_THRESHOLD = 5.0`, `RARE_ZIPF_FLOOR = 1.5` — line 34, 37
- `Vocab` dataclass with `score` property — line 40

## CLI

```
python easy_german.py AUDIO [-o OUT] [--model SIZE] [--min-count N] [--top N] [--save-transcript PATH] [-v]
```

Default output path: `vocab-<audio-stem>.md`.

## Dependencies (`requirements.txt`)

`faster-whisper>=1.0.0`, `spacy>=3.7.0`, `wordfreq>=3.1.0`, `deep-translator>=1.11.4`. Plus the spaCy German model: `python -m spacy download de_core_news_sm`.

## Repo conventions

- `main` branch.
- `.gitignore` excludes audio (`*.wav`, `*.mp3`, `*.m4a`, `*.ogg`, `*.flac`), generated vocab files (`vocab*.md`), and `.vscode/`. Don't commit those.

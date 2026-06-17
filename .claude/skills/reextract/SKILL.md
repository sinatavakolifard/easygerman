---
name: reextract
description: Rebuild stored vocab_entries for already-saved extractions using the current filter logic. Use after changing pipeline filter constants (COMMON_ZIPF_THRESHOLD, KEEP_POS, DIFFICULTY_LEVELS, the bleed-through rules, etc.) in easy_german.py so existing saved extractions pick up the new behaviour.
---

# Rebuilding saved vocab after filter changes

`reextract.py` is a standalone CLI that rebuilds `vocab_entries` rows for already-stored extractions using the **current** filter logic in `easy_german.py`. Run it after changing `COMMON_ZIPF_THRESHOLD`, `KEEP_POS`, `DIFFICULTY_LEVELS`, the English-bleed-through rules, or any other filter/ranking behaviour, so previously-saved extractions reflect the change.

```
python reextract.py [--user EMAIL] [--level {A2+,B1+,B2+,C1+}] [--min-count N] [--top N] [--dry-run]
```

- Loads each extraction's stored transcript, re-runs `extract_vocab` + `translate`, and replaces that extraction's `vocab_entries` rows.
- Idempotent — same effect as clicking the re-extract panel in the web UI for every saved extraction in turn.
- `--dry-run` reports what would change without writing.
- `--top 0` means no cap — keep every word that passed the filters (slow: translation is per-word).

This is the batch/offline counterpart to `POST /api/extractions/<id>/reextract` (the per-extraction web action). The pipeline internals it depends on are documented in `CLAUDE.md` → Pipeline.

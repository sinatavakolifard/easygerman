#!/usr/bin/env python3
"""Re-run extract_vocab + translate against existing saved transcripts.

Useful after changing the filter logic (e.g. lowering COMMON_ZIPF_THRESHOLD,
dropping PROPN, adding the English-bleed filter). Audio files and the
stored transcript stay; only vocab_entries rows are rebuilt.

Examples
--------
  # Rebuild every user's extractions at the default B2+ level:
  python3 reextract.py

  # Only one user, B1+:
  python3 reextract.py --user me@example.com --level B1+

  # See what would change first:
  python3 reextract.py --dry-run
"""
from __future__ import annotations

import argparse
import logging
import sys

from db import connect
from easy_german import (
    DEFAULT_LEVEL,
    DIFFICULTY_LEVELS,
    extract_vocab,
    translate,
)


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--user", help="Limit to a single user email")
    p.add_argument(
        "--level",
        choices=list(DIFFICULTY_LEVELS),
        default=DEFAULT_LEVEL,
        help=f"Difficulty preset (default: {DEFAULT_LEVEL})",
    )
    p.add_argument(
        "--min-count",
        type=int,
        default=None,
        help="Override min_count (default: use each extraction's stored value)",
    )
    p.add_argument(
        "--top",
        type=int,
        default=None,
        help="Override top_k (default: use each extraction's stored value)",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Run extraction + translation but don't touch the DB",
    )
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(message)s",
    )

    max_zipf = DIFFICULTY_LEVELS[args.level]

    db = connect()
    if args.user:
        rows = db.execute(
            """SELECT e.* FROM extractions e
               JOIN users u ON u.id = e.user_id
               WHERE u.email = ?
               ORDER BY e.id""",
            (args.user,),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM extractions ORDER BY id").fetchall()

    if not rows:
        print("No extractions to re-process.")
        return 0

    label = f"all users" if not args.user else f"user {args.user}"
    print(
        f"Re-extracting {len(rows)} extraction(s) for {label} "
        f"at level={args.level} (max_zipf={max_zipf})"
    )
    if args.dry_run:
        print("(dry run — no DB writes)")
    print()

    total_before = 0
    total_after = 0

    for r in rows:
        eid = r["id"]
        filename = r["filename"]
        transcript = r["transcript"] or ""
        if not transcript.strip():
            print(f"  [{eid:>3}] {filename}: SKIPPED (no transcript)")
            continue

        min_count = args.min_count if args.min_count is not None else r["min_count"]
        top_k = args.top if args.top is not None else r["top_k"]

        old_count = db.execute(
            "SELECT COUNT(*) AS n FROM vocab_entries WHERE extraction_id = ?",
            (eid,),
        ).fetchone()["n"]
        total_before += old_count

        vocab = extract_vocab(
            transcript,
            min_count=min_count,
            top_k=top_k,
            max_zipf=max_zipf,
        )
        if vocab:
            translate(vocab)
        total_after += len(vocab)

        print(f"  [{eid:>3}] {filename}: {old_count} -> {len(vocab)} words")

        if not args.dry_run:
            db.execute("DELETE FROM vocab_entries WHERE extraction_id = ?", (eid,))
            db.executemany(
                """INSERT INTO vocab_entries
                      (extraction_id, position, lemma, pos, count, article,
                       meaning, example, example_translation)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        eid, i, v.lemma, v.pos, v.count, v.article,
                        v.meaning, v.example, v.example_translation,
                    )
                    for i, v in enumerate(vocab)
                ],
            )
            db.commit()

    db.close()
    print()
    print(f"Done. Total words: {total_before} -> {total_after}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

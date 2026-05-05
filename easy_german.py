#!/usr/bin/env python3
"""Extract learning-worthy German vocabulary from a podcast audio file.

Pipeline:
  1. Transcribe audio with Whisper (German).
  2. Lemmatize + POS-tag tokens with spaCy.
  3. Keep nouns/verbs/adjectives/adverbs that are not too common
     in everyday German (filtered via wordfreq's Zipf scale).
  4. Rank by an "importance" score: frequent in this episode, rare in general.
  5. Translate each lemma to English and write a Markdown vocab list.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from deep_translator import GoogleTranslator
from faster_whisper import WhisperModel
from wordfreq import zipf_frequency

import spacy

KEEP_POS = {"NOUN", "VERB", "ADJ", "ADV", "PROPN"}
POS_LABEL = {"NOUN": "noun", "VERB": "verb", "ADJ": "adj", "ADV": "adv", "PROPN": "name"}

# Words with a Zipf frequency at or above this are too common to be worth
# learning (e.g. "haben", "machen", "gut"). Zipf 5.0 is roughly the top ~3000
# most common words in everyday text.
COMMON_ZIPF_THRESHOLD = 5.0

# Below this Zipf, words are so rare they may be names, typos, or noise.
RARE_ZIPF_FLOOR = 1.5


@dataclass
class Vocab:
    lemma: str
    pos: str
    count: int
    zipf: float
    first_index: int = 0
    example: str = ""
    meaning: str = ""
    example_translation: str = ""

    @property
    def score(self) -> float:
        # frequent in episode, rare in general usage
        return self.count * max(0.0, 7.5 - self.zipf)


def transcribe(audio_path: Path, model_size: str) -> str:
    logging.info("Loading Whisper model: %s", model_size)
    model = WhisperModel(model_size, device="auto", compute_type="auto")
    logging.info("Transcribing %s (this can take a while on CPU)", audio_path)
    segments, _ = model.transcribe(str(audio_path), language="de", vad_filter=True)
    return " ".join(seg.text.strip() for seg in segments)


def load_spacy() -> "spacy.language.Language":
    try:
        return spacy.load("de_core_news_sm")
    except OSError:
        sys.exit(
            "German spaCy model not found.\n"
            "Install it once with:\n"
            "    python -m spacy download de_core_news_sm"
        )


def extract_vocab(transcript: str, min_count: int, top_k: int) -> list[Vocab]:
    nlp = load_spacy()
    doc = nlp(transcript)

    counts: Counter[tuple[str, str]] = Counter()
    examples: dict[tuple[str, str], str] = {}
    first_index: dict[tuple[str, str], int] = {}

    for sent in doc.sents:
        for tok in sent:
            if tok.is_stop or tok.is_punct or tok.is_space:
                continue
            if not tok.lemma_ or not tok.lemma_.replace("-", "").isalpha():
                continue
            if tok.pos_ not in KEEP_POS:
                continue
            key = (tok.lemma_, tok.pos_)
            counts[key] += 1
            examples.setdefault(key, sent.text.strip())
            first_index.setdefault(key, tok.i)

    vocab: list[Vocab] = []
    for (lemma, pos), count in counts.items():
        zipf = zipf_frequency(lemma.lower(), "de")
        if zipf >= COMMON_ZIPF_THRESHOLD or zipf < RARE_ZIPF_FLOOR:
            continue
        if count < min_count:
            continue
        vocab.append(
            Vocab(
                lemma=lemma,
                pos=POS_LABEL[pos],
                count=count,
                zipf=zipf,
                first_index=first_index[(lemma, pos)],
                example=examples[(lemma, pos)],
            )
        )

    # Pick the top_k most "important" words, then present them in the order
    # they first appear in the audio.
    vocab.sort(key=lambda v: v.score, reverse=True)
    selected = vocab[:top_k]
    selected.sort(key=lambda v: v.first_index)
    return selected


def _translate_batch(translator: GoogleTranslator, items: list[str]) -> list[str]:
    try:
        return translator.translate_batch(items)
    except Exception as exc:
        logging.warning("Batch translation failed (%s); retrying one-by-one", exc)
        results: list[str] = []
        for item in items:
            try:
                results.append(translator.translate(item) or "")
            except Exception:
                results.append("")
        return results


def translate(vocab: list[Vocab]) -> None:
    if not vocab:
        return
    logging.info("Translating %d words and example sentences to English", len(vocab))
    translator = GoogleTranslator(source="de", target="en")
    lemma_results = _translate_batch(translator, [v.lemma for v in vocab])
    example_results = _translate_batch(translator, [v.example for v in vocab])
    for v, lemma_t, example_t in zip(vocab, lemma_results, example_results):
        v.meaning = (lemma_t or "").strip()
        v.example_translation = (example_t or "").strip()


def write_markdown(vocab: list[Vocab], out_path: Path, source: Path) -> None:
    lines = [
        f"# Vocabulary — {source.name}",
        "",
        "| German | POS | Count | Meaning | Example |",
        "| --- | --- | --- | --- | --- |",
    ]
    for v in vocab:
        example = v.example.replace("|", "\\|").replace("\n", " ")
        meaning = v.meaning.replace("|", "\\|")
        example_translation = v.example_translation.replace("|", "\\|").replace("\n", " ")
        if example_translation:
            example_cell = f"{example}<br>*{example_translation}*"
        else:
            example_cell = example
        lines.append(f"| {v.lemma} | {v.pos} | {v.count} | {meaning} | {example_cell} |")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    logging.info("Wrote %d entries to %s", len(vocab), out_path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract German vocabulary from a podcast audio file.",
    )
    parser.add_argument("audio", type=Path, help="Audio file (mp3, wav, m4a, ogg, ...)")
    parser.add_argument("-o", "--output", type=Path, default=None)
    parser.add_argument(
        "--model",
        default="medium",
        help="Whisper model size: tiny | base | small | medium | large-v3 (default: medium)",
    )
    parser.add_argument(
        "--min-count",
        type=int,
        default=1,
        help="Minimum times a word must appear in the episode (default: 1)",
    )
    parser.add_argument(
        "--top",
        type=int,
        default=50,
        help="Maximum number of words to keep (default: 50)",
    )
    parser.add_argument(
        "--save-transcript",
        type=Path,
        help="Optional path to save the raw German transcript",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(message)s",
    )

    if not args.audio.is_file():
        sys.exit(f"Audio file not found: {args.audio}")
    
    if args.output is None:
        audio_name = args.audio.stem
        args.output = Path(f"vocab-{audio_name}.md")

    transcript = transcribe(args.audio, model_size=args.model)
    if args.save_transcript:
        args.save_transcript.write_text(transcript, encoding="utf-8")
        logging.info("Saved transcript to %s", args.save_transcript)

    vocab = extract_vocab(transcript, min_count=args.min_count, top_k=args.top)
    if not vocab:
        sys.exit("No vocabulary extracted. Try lowering --min-count or check the audio.")

    translate(vocab)
    write_markdown(vocab, args.output, args.audio)


if __name__ == "__main__":
    main()

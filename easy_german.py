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
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

from deep_translator import GoogleTranslator
from faster_whisper import WhisperModel
from wordfreq import zipf_frequency

import spacy

KEEP_POS = {"NOUN", "VERB", "ADJ", "ADV"}
POS_LABEL = {"NOUN": "noun", "VERB": "verb", "ADJ": "adj", "ADV": "adv"}

# Map spaCy's morphological Gender feature to the matching nominative article.
GENDER_ARTICLE = {"Masc": "der", "Fem": "die", "Neut": "das"}

# Common German plural suffixes, longest-first so the suffix-stripper
# considers the most specific match first.
PLURAL_SUFFIXES = ("nen", "en", "er", "n", "e", "s")

_UMLAUT_TABLE = str.maketrans("äöüÄÖÜ", "aouAOU")


def _de_un_umlaut(word: str) -> str:
    """Un-umlaut only the rightmost umlauted vowel.

    German plural umlaut shifts the vowel in the head of a compound
    (Hörbuch → Hörbücher). A blanket replacement would also strip
    legitimate umlauts elsewhere in the word (the "ö" in "Hör-"),
    so we only revert the last one.
    """
    for i in range(len(word) - 1, -1, -1):
        if word[i] in "äöüÄÖÜ":
            return word[:i] + word[i].translate(_UMLAUT_TABLE) + word[i + 1 :]
    return word


def try_singularize(plural: str, gender: str = "") -> str:
    """Best-effort plural→singular for German nouns.

    Only meant to run on tokens spaCy left untouched (lemma == surface
    form, but Number=Plur). For each candidate we strip a plural suffix
    and also try the un-umlauted variant (German plurals often add an
    umlaut: Buch → Bücher, Mutter → Mütter). If wordfreq recognises a
    candidate (>= RARE_ZIPF_FLOOR), pick the most frequent. Otherwise
    fall back to gender-aware rule-of-thumb for compounds that aren't
    in the dictionary.
    """
    candidates: list[str] = []
    for suffix in PLURAL_SUFFIXES:
        if plural.endswith(suffix):
            stem = plural[: -len(suffix)]
            if len(stem) >= 3:
                candidates.append(stem)
                un = _de_un_umlaut(stem)
                if un != stem:
                    candidates.append(un)
    # Also try un-umlauting the original (Vater/Väter, Mutter/Mütter pattern).
    un_orig = _de_un_umlaut(plural)
    if un_orig != plural:
        candidates.append(un_orig)

    if candidates:
        best = max(candidates, key=lambda c: zipf_frequency(c.lower(), "de"))
        if zipf_frequency(best.lower(), "de") >= RARE_ZIPF_FLOOR:
            return best

    # Compound noun — wordfreq has no opinion. Apply the most common
    # plural→singular patterns, with two refinements:
    #   * "-en" disambiguated by gender — feminine "-e" nouns add "-n"
    #     (Markentankstelle → Markentankstellen), masc/neut consonant
    #     nouns add "-en" (Tür → Türen).
    #   * "-er" plurals usually carry an umlaut shift (Hörbuch → Hörbücher),
    #     so reverse it.
    if plural.endswith("en"):
        return plural[:-1] if gender == "Fem" else plural[:-2]
    if plural.endswith("er"):
        return _de_un_umlaut(plural[:-2])
    if plural.endswith("e"):
        return plural[:-1]
    if plural.endswith(("n", "s")):
        return plural[:-1]
    return plural

# Words with a Zipf frequency at or above this are too common to be worth
# learning. Default targets B2+ vocab. Rough mapping (zipf is a log scale):
#   5.5 ≈ A1+, 5.0 ≈ A2+, 4.5 ≈ B1+, 4.0 ≈ B2+ (default), 3.5 ≈ C1+.
COMMON_ZIPF_THRESHOLD = 4.0

# Below this Zipf, words are so rare they may be names, typos, or noise.
RARE_ZIPF_FLOOR = 1.5

# Named CEFR-ish difficulty presets. Keys are exposed in the web UI; values
# are the zipf upper-bound (any word more common than this is filtered out).
DIFFICULTY_LEVELS = {
    "A2+": 5.0,
    "B1+": 4.5,
    "B2+": 4.0,
    "C1+": 3.5,
}
DEFAULT_LEVEL = "B2+"


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
    article: str = ""

    @property
    def display(self) -> str:
        return f"{self.article} {self.lemma}" if self.article else self.lemma

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


def extract_vocab(
    transcript: str,
    min_count: int,
    top_k: int,
    max_zipf: float = COMMON_ZIPF_THRESHOLD,
) -> list[Vocab]:
    nlp = load_spacy()
    doc = nlp(transcript)

    counts: Counter[tuple[str, str]] = Counter()
    examples: dict[tuple[str, str], str] = {}
    first_index: dict[tuple[str, str], int] = {}
    # gender per noun lemma, voted across surface forms (e.g. "Bank" can be Fem
    # in both meanings, but "Banken" only disambiguates as Fem when in context)
    genders: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)

    for sent in doc.sents:
        for tok in sent:
            if tok.is_stop or tok.is_punct or tok.is_space:
                continue
            if not tok.lemma_ or not tok.lemma_.replace("-", "").isalpha():
                continue
            if tok.pos_ not in KEEP_POS:
                continue
            lemma = tok.lemma_
            gender_vals = tok.morph.get("Gender") if tok.pos_ == "NOUN" else []
            # Only try to singularize when spaCy didn't already do it
            # (lemma == surface form). For tokens spaCy already lemmatized
            # to the singular, leave them alone.
            if (
                tok.pos_ == "NOUN"
                and tok.morph.get("Number") == ["Plur"]
                and tok.lemma_.lower() == tok.text.lower()
            ):
                lemma = try_singularize(lemma, gender_vals[0] if gender_vals else "")
            key = (lemma, tok.pos_)
            counts[key] += 1
            examples.setdefault(key, sent.text.strip())
            first_index.setdefault(key, tok.i)
            if tok.pos_ == "NOUN" and gender_vals:
                genders[key][gender_vals[0]] += 1

    # Merge keys that share a case-folded lemma. spaCy occasionally splits
    # the same word across multiple POS tags within one transcript (e.g.
    # "unpopular" tagged as both NOUN and ADV), or across cases ("Unpopular"
    # NOUN and "unpopular" NOUN). Without this, the same word appears 3-5
    # times in the result.
    _POS_PRIORITY = {"NOUN": 4, "VERB": 3, "ADJ": 2, "ADV": 1}
    groups: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for key in counts:
        groups[key[0].lower()].append(key)
    if any(len(g) > 1 for g in groups.values()):
        new_counts: Counter[tuple[str, str]] = Counter()
        new_examples: dict[tuple[str, str], str] = {}
        new_first: dict[tuple[str, str], int] = {}
        new_genders: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
        for entries in groups.values():
            if len(entries) == 1:
                k = entries[0]
                new_counts[k] = counts[k]
                new_examples[k] = examples[k]
                new_first[k] = first_index[k]
                if k in genders:
                    new_genders[k] = genders[k]
                continue
            # Winner: highest count, then POS priority, then title-case
            # for nouns (German nouns are capitalised).
            def _score(k: tuple[str, str]) -> tuple[int, int, int]:
                lemma, pos = k
                return (
                    counts[k],
                    _POS_PRIORITY.get(pos, 0),
                    1 if pos == "NOUN" and lemma[:1].isupper() else 0,
                )
            winner = max(entries, key=_score)
            new_counts[winner] = sum(counts[k] for k in entries)
            earliest = min(entries, key=lambda k: first_index[k])
            new_examples[winner] = examples[earliest]
            new_first[winner] = first_index[earliest]
            combined: Counter[str] = Counter()
            for k in entries:
                combined.update(genders.get(k, Counter()))
            if combined:
                new_genders[winner] = combined
        counts = new_counts
        examples = new_examples
        first_index = new_first
        genders = new_genders

    vocab: list[Vocab] = []
    for (lemma, pos), count in counts.items():
        lower = lemma.lower()
        zipf = zipf_frequency(lower, "de")
        if zipf >= max_zipf or zipf < RARE_ZIPF_FLOOR:
            continue
        # Drop English bleed-through. If the word is meaningfully more common
        # in English than German (10x = +1.0 on the zipf log scale), it's
        # probably not the German vocab the learner wants. Genuine German
        # loanwords like "Computer" or "Internet" stay because their German
        # zipf is similar or higher than the English one.
        zipf_en = zipf_frequency(lower, "en")
        if zipf_en > zipf + 1.0:
            continue
        # Hyphenated compounds where every part is more English than German
        # ("Unpopular-Opinion"). The check above misses these because the
        # whole compound has zipf 0 in both languages.
        if "-" in lower:
            parts = [p for p in lower.split("-") if len(p) >= 3]
            if parts and all(
                zipf_frequency(p, "en") > zipf_frequency(p, "de") + 1.0
                for p in parts
            ):
                continue
        if count < min_count:
            continue
        article = ""
        if pos == "NOUN" and genders[(lemma, pos)]:
            top_gender = genders[(lemma, pos)].most_common(1)[0][0]
            article = GENDER_ARTICLE.get(top_gender, "")
        vocab.append(
            Vocab(
                lemma=lemma,
                pos=POS_LABEL[pos],
                count=count,
                zipf=zipf,
                first_index=first_index[(lemma, pos)],
                example=examples[(lemma, pos)],
                article=article,
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
        lines.append(f"| {v.display} | {v.pos} | {v.count} | {meaning} | {example_cell} |")
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
        "--max-zipf",
        type=float,
        default=COMMON_ZIPF_THRESHOLD,
        help=(
            "Drop words at or above this Zipf frequency (default %(default)s ≈ B2+). "
            "Use 4.5 for B1+, 3.5 for C1+."
        ),
    )
    parser.add_argument(
        "--level",
        choices=list(DIFFICULTY_LEVELS),
        default=None,
        help=(
            "CEFR-ish preset that overrides --max-zipf: "
            + ", ".join(f"{k}={v}" for k, v in DIFFICULTY_LEVELS.items())
        ),
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

    max_zipf = DIFFICULTY_LEVELS[args.level] if args.level else args.max_zipf
    vocab = extract_vocab(
        transcript,
        min_count=args.min_count,
        top_k=args.top,
        max_zipf=max_zipf,
    )
    if not vocab:
        sys.exit("No vocabulary extracted. Try lowering --min-count or check the audio.")

    translate(vocab)
    write_markdown(vocab, args.output, args.audio)


if __name__ == "__main__":
    main()

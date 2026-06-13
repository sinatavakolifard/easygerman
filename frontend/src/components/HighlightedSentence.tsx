import { Fragment } from "react";

// Decide whether a sentence word corresponds to the vocab lemma. The lemma is
// the dictionary form (e.g. "schützen", "Umwelt") while the sentence has the
// inflected surface form ("schützt", "Umwelten"), so exact match isn't enough.
// Heuristic: equal, one is a prefix of the other, or they share a long enough
// prefix (catches verb/adjective endings). Conservative thresholds keep it
// from bolding merely-similar words.
function matchesLemma(word: string, lemma: string): boolean {
  if (word === lemma) return true;
  if (lemma.length >= 4 && word.startsWith(lemma)) return true;
  if (word.length >= 4 && lemma.startsWith(word)) return true;
  const min = Math.min(word.length, lemma.length);
  let shared = 0;
  while (shared < min && word[shared] === lemma[shared]) shared++;
  return shared >= Math.max(4, Math.ceil(min * 0.75));
}

interface HighlightedSentenceProps {
  text: string;
  lemma: string;
}

// Renders `text` with occurrences of the vocab word emphasised in <strong>.
export default function HighlightedSentence({
  text,
  lemma,
}: HighlightedSentenceProps) {
  const target = lemma.trim().toLowerCase();
  if (!text || !target) return <>{text}</>;

  // Split into alternating non-word / word chunks (words land on odd indices).
  const chunks = text.split(/(\p{L}[\p{L}'-]*)/u);

  return (
    <>
      {chunks.map((chunk, i) =>
        i % 2 === 1 && matchesLemma(chunk.toLowerCase(), target) ? (
          <strong key={i} className="lemma-hit">
            {chunk}
          </strong>
        ) : (
          <Fragment key={i}>{chunk}</Fragment>
        )
      )}
    </>
  );
}

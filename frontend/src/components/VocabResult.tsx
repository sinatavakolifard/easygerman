import { Link } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { useConfig } from "../ConfigContext";
import HighlightedSentence from "./HighlightedSentence";
import type { Extraction, User, Vocab } from "../types";

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"}
         stroke="currentColor" strokeWidth="2" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

interface ActionButtonsProps {
  v: Vocab;
  saved: boolean;
  busy: boolean;
  onEditWord?: (v: Vocab) => void;
  onToggleSave?: (v: Vocab) => void;
}

// The per-row edit + save buttons. Rendered twice per row: once in a hidden
// inline copy inside the lemma cell (shown on mobile, where the table reflows
// to cards) and once in the trailing actions column (shown on desktop). CSS
// shows exactly one per breakpoint — a `position: absolute` <td> can't be
// pinned reliably in a reflowed table, so we duplicate instead.
function ActionButtons({
  v,
  saved,
  busy,
  onEditWord,
  onToggleSave,
}: ActionButtonsProps) {
  return (
    <>
      {onEditWord && (
        <button
          type="button"
          className="edit-toggle"
          onClick={(e) => {
            onEditWord(v);
            e.currentTarget.blur();
          }}
          aria-label={`Edit ${v.lemma}`}
          title="Edit word"
        >
          <PencilIcon />
        </button>
      )}
      {onToggleSave && (
        <button
          type="button"
          className={`save-toggle ${saved ? "saved" : ""}`}
          onClick={(e) => {
            onToggleSave(v);
            e.currentTarget.blur();
          }}
          disabled={busy}
          aria-pressed={saved}
          aria-label={saved ? `Unsave ${v.lemma}` : `Save ${v.lemma}`}
          title={saved ? "Remove from saved words" : "Save word"}
        >
          <StarIcon filled={saved} />
        </button>
      )}
    </>
  );
}

function vocabKey(v: Vocab): string {
  return `${v.lemma}|${v.pos}`;
}

interface VocabResultProps {
  data: Extraction | null;
  currentUser?: User | null;
  controls?: ReactNode;
  headerAction?: ReactNode;
  savedMap?: Map<string, number>;
  onToggleSave?: (v: Vocab) => void;
  savingKey?: string | null;
  onEditWord?: (v: Vocab) => void;
}

export default function VocabResult({
  data,
  currentUser,
  controls,
  headerAction,
  savedMap,
  onToggleSave,
  savingKey,
  onEditWord,
}: VocabResultProps) {
  const { features, ready } = useConfig();
  const [starredOnly, setStarredOnly] = useState(false);
  const [query, setQuery] = useState("");
  if (!data) return null;
  const {
    filename,
    model,
    min_count,
    top_k,
    transcript,
    audio_token,
    vocab,
    anonymous,
  } = data;
  const audioUrl = audio_token ? `/audio/${audio_token}` : null;

  // Filter the table by a text query (word + meaning) and, when a savedMap is
  // passed (the logged-in extraction view), by starred-only. The anonymous
  // result can't star words, so only its search box shows.
  const isSaved = (v: Vocab) => Boolean(savedMap?.has(vocabKey(v)));
  const q = query.trim().toLowerCase();
  const matchesQuery = (v: Vocab) =>
    !q ||
    v.lemma.toLowerCase().includes(q) ||
    (v.meaning || "").toLowerCase().includes(q);
  const shownVocab = vocab.filter(
    (v) => (!starredOnly || isSaved(v)) && matchesQuery(v)
  );
  const canFilterStarred = Boolean(savedMap);

  return (
    <>
      <p>
        {currentUser ? (
          <Link to="/library">← Back to library</Link>
        ) : (
          <Link to="/">← Upload another file</Link>
        )}
      </p>
      <h1>Vocabulary</h1>
      <div className="result-header">
        <p className="meta">
          <strong>{filename}</strong>
          &nbsp;·&nbsp; model: {model}
          &nbsp;·&nbsp; min-count: {min_count}
          &nbsp;·&nbsp; top: {top_k}
          &nbsp;·&nbsp; {vocab.length} words
        </p>
        {headerAction}
      </div>

      {anonymous && (
        <p className="anon-notice">
          You're not logged in, so this result isn't saved.{" "}
          <Link to="/signup">Sign up</Link> or <Link to="/login">log in</Link> to keep it
          in your library.
        </p>
      )}

      {controls}

      {audioUrl && ready && features.audio && (
        <audio className="player" controls preload="metadata" src={audioUrl}>
          Your browser does not support audio playback.
        </audio>
      )}

      {vocab.length > 0 && (
        <div className="vocab-filter">
          <input
            type="search"
            className="vocab-search"
            placeholder="Search words or meanings…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search words"
          />
          {canFilterStarred && (
            <label className="vocab-filter-toggle">
              <input
                type="checkbox"
                checked={starredOnly}
                onChange={(e) => setStarredOnly(e.target.checked)}
              />
              <span>Starred only</span>
            </label>
          )}
          <span className="vocab-filter-count">
            {shownVocab.length} of {vocab.length}
          </span>
        </div>
      )}

      {vocab.length === 0 ? (
        <p>
          No vocabulary extracted. Try lowering <em>min count</em>, or check that the
          audio is in German.
        </p>
      ) : shownVocab.length === 0 ? (
        <p className="empty-state">
          No words match {query.trim() ? "your search" : "this filter"}
          {starredOnly ? " in your starred words" : ""}.
        </p>
      ) : (
        <table className="vocab">
          <thead>
            <tr>
              <th>German</th>
              <th>POS</th>
              <th>Count</th>
              <th>Meaning</th>
              <th>Example</th>
              {(onToggleSave || onEditWord) && (
                <th className="row-actions-h" aria-label="Actions"></th>
              )}
            </tr>
          </thead>
          <tbody>
            {shownVocab.map((v, i) => {
              const key = vocabKey(v);
              const saved = savedMap ? savedMap.has(key) : false;
              const busy = savingKey === key;
              return (
              <tr key={i}>
                <td className="lemma">
                  <span className="lemma-text">
                    {v.article && <span className="article">{v.article}</span>}
                    {v.article ? " " : ""}
                    {v.lemma}
                  </span>
                  {(onEditWord || onToggleSave) && (
                    <span className="lemma-actions">
                      <ActionButtons
                        v={v}
                        saved={saved}
                        busy={busy}
                        onEditWord={onEditWord}
                        onToggleSave={onToggleSave}
                      />
                    </span>
                  )}
                </td>
                <td className="pos">{v.pos}</td>
                <td className="count">{v.count}</td>
                <td className="meaning">{v.meaning}</td>
                <td className="example">
                  <div className="example-de">
                    <HighlightedSentence text={v.example} lemma={v.lemma} />
                  </div>
                  {v.example_translation && (
                    <div className="example-en">{v.example_translation}</div>
                  )}
                </td>
                {(onEditWord || onToggleSave) && (
                  <td className="row-actions">
                    <ActionButtons
                      v={v}
                      saved={saved}
                      busy={busy}
                      onEditWord={onEditWord}
                      onToggleSave={onToggleSave}
                    />
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <details className="transcript">
        <summary>Show raw transcript</summary>
        <pre>{transcript}</pre>
      </details>
    </>
  );
}

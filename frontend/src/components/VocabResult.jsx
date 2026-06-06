import { Link } from "react-router-dom";
import { useConfig } from "../ConfigContext.jsx";

function StarIcon({ filled }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"}
         stroke="currentColor" strokeWidth="2" strokeLinecap="round"
         strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function vocabKey(v) {
  return `${v.lemma}|${v.pos}`;
}

export default function VocabResult({
  data,
  currentUser,
  controls,
  headerAction,
  savedMap,
  onToggleSave,
  savingKey,
}) {
  const { features } = useConfig();
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

      {audioUrl && features.audio && (
        <audio className="player" controls preload="metadata" src={audioUrl}>
          Your browser does not support audio playback.
        </audio>
      )}

      {vocab.length > 0 ? (
        <table className="vocab">
          <thead>
            <tr>
              <th>German</th>
              <th>POS</th>
              <th>Count</th>
              <th>Meaning</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            {vocab.map((v, i) => {
              const key = vocabKey(v);
              const saved = savedMap ? savedMap.has(key) : false;
              const busy = savingKey === key;
              return (
              <tr key={i}>
                <td className="lemma">
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
                  <span className="lemma-text">
                    {v.article && <span className="article">{v.article}</span>}
                    {v.article ? " " : ""}
                    {v.lemma}
                  </span>
                </td>
                <td className="pos">{v.pos}</td>
                <td className="count">{v.count}</td>
                <td className="meaning">{v.meaning}</td>
                <td className="example">
                  <div className="example-de">{v.example}</div>
                  {v.example_translation && (
                    <div className="example-en">{v.example_translation}</div>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p>
          No vocabulary extracted. Try lowering <em>min count</em>, or check that the
          audio is in German.
        </p>
      )}

      <details className="transcript">
        <summary>Show raw transcript</summary>
        <pre>{transcript}</pre>
      </details>
    </>
  );
}

import { Link } from "react-router-dom";

export default function VocabResult({ data, currentUser, controls }) {
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
      <p className="meta">
        <strong>{filename}</strong>
        &nbsp;·&nbsp; model: {model}
        &nbsp;·&nbsp; min-count: {min_count}
        &nbsp;·&nbsp; top: {top_k}
        &nbsp;·&nbsp; {vocab.length} words
      </p>

      {anonymous && (
        <p className="anon-notice">
          You're not logged in, so this result isn't saved.{" "}
          <Link to="/signup">Sign up</Link> or <Link to="/login">log in</Link> to keep it
          in your library.
        </p>
      )}

      {controls}

      {audioUrl && (
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
            {vocab.map((v, i) => (
              <tr key={i}>
                <td className="lemma">
                  {v.article && <span className="article">{v.article}</span>}
                  {v.article ? " " : ""}
                  {v.lemma}
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
            ))}
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

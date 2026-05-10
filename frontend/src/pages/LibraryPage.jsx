import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function LibraryPage() {
  const [extractions, setExtractions] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .library()
      .then((data) => setExtractions(data.extractions))
      .catch((e) => setError(e.message || "Failed to load library"));
  }, []);

  if (error) return <p className="form-error">{error}</p>;
  if (extractions === null) return <p>Loading…</p>;

  return (
    <>
      <div className="library-header">
        <h1>Your library</h1>
        <Link to="/" className="primary-link">
          + New extraction
        </Link>
      </div>

      {extractions.length === 0 ? (
        <p className="empty-state">
          You haven't extracted any audio yet. <Link to="/">Upload your first file</Link>.
        </p>
      ) : (
        <ul className="extraction-list">
          {extractions.map((e) => (
            <li className="extraction-card" key={e.id}>
              <Link to={`/extraction/${e.id}`} className="extraction-title">
                {e.filename}
              </Link>
              <p className="extraction-meta">
                {e.created_at}
                &nbsp;·&nbsp; {e.word_count} word{e.word_count === 1 ? "" : "s"}
                &nbsp;·&nbsp; model: {e.model}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

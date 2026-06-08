import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useConfig } from "../ConfigContext.jsx";

export default function LibraryPage() {
  const { features, ready } = useConfig();
  const [extractions, setExtractions] = useState(null);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    api
      .library()
      .then((data) => setExtractions(data.extractions))
      .catch((e) => setError(e.message || "Failed to load library"));
  }, []);

  const onDelete = async (e) => {
    if (
      !window.confirm(
        `Delete "${e.filename}"? The audio file and all extracted vocab will be removed. This can't be undone.`
      )
    ) {
      return;
    }
    setDeletingId(e.id);
    try {
      await api.deleteExtraction(e.id);
      setExtractions((rows) => rows.filter((r) => r.id !== e.id));
    } catch (err) {
      setError(err.message || "Failed to delete extraction");
    } finally {
      setDeletingId(null);
    }
  };

  if (error) return <p className="form-error">{error}</p>;
  if (extractions === null || !ready) return <p>Loading…</p>;

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
              <div className="extraction-content">
                <Link to={`/extraction/${e.id}`} className="extraction-title">
                  {e.filename}
                </Link>
                <p className="extraction-meta">
                  {e.created_at}
                  &nbsp;·&nbsp; {e.word_count} word{e.word_count === 1 ? "" : "s"}
                  &nbsp;·&nbsp; model: {e.model}
                </p>
              </div>
              {features.delete && (
                <button
                  type="button"
                  className="extraction-delete"
                  onClick={() => onDelete(e)}
                  disabled={deletingId === e.id}
                  aria-label={`Delete ${e.filename}`}
                >
                  {deletingId === e.id ? "Deleting…" : "Delete"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

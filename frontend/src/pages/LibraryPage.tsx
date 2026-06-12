import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useConfig } from "../ConfigContext";
import Toast from "../components/Toast";
import { useConfirm } from "../components/ConfirmProvider";
import type { ApiError, LibraryItem } from "../types";

export default function LibraryPage() {
  const confirm = useConfirm();
  const { features, ready } = useConfig();
  const [extractions, setExtractions] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null); // fatal: load failed
  const [notice, setNotice] = useState<string | null>(null); // transient: action failed
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    api
      .library()
      .then((data) => setExtractions(data.extractions))
      .catch((e: ApiError) => setError(e.message || "Failed to load library"));
  }, []);

  const onDelete = async (e: LibraryItem) => {
    const ok = await confirm({
      title: "Delete extraction",
      message: `Delete “${e.filename}”? The audio file and all extracted vocab will be removed. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setDeletingId(e.id);
    try {
      await api.deleteExtraction(e.id);
      setExtractions((rows) => (rows ?? []).filter((r) => r.id !== e.id));
    } catch (err) {
      // Non-fatal: keep the library list on screen.
      setNotice((err as ApiError).message || "Couldn't delete the extraction.");
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
      <Toast message={notice} onClose={() => setNotice(null)} />
    </>
  );
}

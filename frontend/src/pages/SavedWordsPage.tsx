import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import Toast from "../components/Toast";
import EditWordModal from "../components/EditWordModal";
import HighlightedSentence from "../components/HighlightedSentence";
import { useConfirm } from "../components/ConfirmProvider";
import { useConfig } from "../ConfigContext";
import type { ApiError, SavedWord, WordEditFields } from "../types";

export default function SavedWordsPage() {
  const confirm = useConfirm();
  const { features } = useConfig();
  const [words, setWords] = useState<SavedWord[] | null>(null);
  const [error, setError] = useState<string | null>(null); // fatal: load failed
  const [notice, setNotice] = useState<string | null>(null); // transient: action failed
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [editing, setEditing] = useState<SavedWord | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    api
      .savedWords()
      .then((res) => setWords(res.words))
      .catch((e: ApiError) => setError(e.message || "Failed to load saved words"));
  }, []);

  const onRemove = async (w: SavedWord) => {
    const ok = await confirm({
      title: "Remove saved word",
      message: `Remove “${w.lemma}” from your saved words?`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setRemovingId(w.id);
    try {
      await api.deleteSavedWord(w.id);
      setWords((rows) => (rows ?? []).filter((r) => r.id !== w.id));
    } catch (err) {
      // Non-fatal: keep the list on screen.
      setNotice((err as ApiError).message || "Couldn't remove the word.");
    } finally {
      setRemovingId(null);
    }
  };

  const onSaveEdit = async (fields: WordEditFields) => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const { word } = await api.editSavedWord(editing.id, fields);
      setWords((rows) => (rows ?? []).map((r) => (r.id === word.id ? word : r)));
      setEditing(null);
    } catch (err) {
      setNotice((err as ApiError).message || "Couldn't save the edit.");
    } finally {
      setSavingEdit(false);
    }
  };

  if (error) return <p className="form-error">{error}</p>;
  if (words === null) return <p>Loading…</p>;

  return (
    <>
      <div className="library-header">
        <h1>Saved words</h1>
        <Link to="/library" className="primary-link">
          Library
        </Link>
      </div>

      {words.length === 0 ? (
        <p className="empty-state">
          You haven't saved any words yet. From an extraction's vocabulary table,
          tap the star next to a word to add it here.
        </p>
      ) : (
        <ul className="saved-list">
          {words.map((w) => (
            <li className="saved-card" key={w.id}>
              <div className="saved-content">
                <div className="saved-lemma">
                  {w.article && <span className="article">{w.article}</span>}
                  {w.article ? " " : ""}
                  {w.lemma}
                  <span className="saved-pos"> · {w.pos}</span>
                </div>
                {w.meaning && <p className="saved-meaning">{w.meaning}</p>}
                {w.example && (
                  <div className="saved-example">
                    <div className="example-de">
                      <HighlightedSentence text={w.example} lemma={w.lemma} />
                    </div>
                    {w.example_translation && (
                      <div className="example-en">{w.example_translation}</div>
                    )}
                  </div>
                )}
                <p className="saved-meta">
                  {w.source_filename ? `from ${w.source_filename}` : "—"}
                  &nbsp;·&nbsp; saved {w.saved_at}
                </p>
              </div>
              <div className="card-actions">
                {features.edit && (
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={() => setEditing(w)}
                    aria-label={`Edit ${w.lemma}`}
                  >
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="extraction-delete"
                  onClick={() => onRemove(w)}
                  disabled={removingId === w.id}
                  aria-label={`Remove ${w.lemma}`}
                >
                  {removingId === w.id ? "Removing…" : "Remove"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <EditWordModal
          word={editing}
          saving={savingEdit}
          onSave={onSaveEdit}
          onCancel={() => setEditing(null)}
        />
      )}
      <Toast message={notice} onClose={() => setNotice(null)} />
    </>
  );
}

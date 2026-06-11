import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import { useConfig } from "../ConfigContext.jsx";
import ReextractPanel from "../components/ReextractPanel.jsx";
import VocabResult from "../components/VocabResult.jsx";
import Toast from "../components/Toast.jsx";
import EditWordModal from "../components/EditWordModal.jsx";
import { useConfirm } from "../components/ConfirmProvider.jsx";

export default function ExtractionPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { features, ready } = useConfig();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null); // fatal: extraction failed to load
  const [notice, setNotice] = useState(null); // transient: action failed
  const [deleting, setDeleting] = useState(false);
  const [savedMap, setSavedMap] = useState(new Map());
  const [savingKey, setSavingKey] = useState(null);
  const [editing, setEditing] = useState(null); // vocab entry being edited
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .extraction(id)
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load extraction"));
  }, [id]);

  const loadSavedWords = useCallback(() => {
    if (!user) return;
    api
      .savedWords()
      .then((res) => {
        const m = new Map();
        for (const w of res.words) m.set(`${w.lemma}|${w.pos}`, w.id);
        setSavedMap(m);
      })
      .catch(() => { /* non-fatal; user just won't see saved state */ });
  }, [user]);

  useEffect(() => {
    loadSavedWords();
  }, [loadSavedWords]);

  const onToggleSave = async (v) => {
    const key = `${v.lemma}|${v.pos}`;
    if (savingKey) return; // ignore rapid double-clicks
    setSavingKey(key);
    try {
      const existingId = savedMap.get(key);
      if (existingId) {
        await api.deleteSavedWord(existingId);
        const next = new Map(savedMap);
        next.delete(key);
        setSavedMap(next);
      } else {
        const res = await api.saveWord({
          lemma: v.lemma,
          pos: v.pos,
          article: v.article || "",
          meaning: v.meaning || "",
          example: v.example || "",
          example_translation: v.example_translation || "",
          source_filename: data?.filename || "",
        });
        const next = new Map(savedMap);
        next.set(key, res.id);
        setSavedMap(next);
      }
    } catch (err) {
      // Non-fatal: keep the vocab on screen, just flag that the save failed.
      setNotice(err.message || "Couldn't update saved words.");
    } finally {
      setSavingKey(null);
    }
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: "Delete extraction",
      message: `Delete “${data.filename}”? The audio file and all extracted vocab will be removed. This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteExtraction(id);
      navigate("/library");
    } catch (err) {
      setNotice(err.message || "Couldn't delete the extraction.");
      setDeleting(false);
    }
  };

  const onSaveEdit = async (fields) => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      const updated = await api.editVocab(id, editing.id, fields);
      setData(updated);
      // lemma/meaning may have changed → refresh the saved-state map.
      loadSavedWords();
      setEditing(null);
    } catch (err) {
      setNotice(err.message || "Couldn't save the edit.");
    } finally {
      setSavingEdit(false);
    }
  };

  if (error) return <p className="form-error">{error}</p>;
  if (!data || !ready) return <p>Loading…</p>;

  const headerAction = features.delete ? (
    <button
      type="button"
      className="extraction-delete"
      onClick={onDelete}
      disabled={deleting}
    >
      {deleting ? "Deleting…" : "Delete extraction"}
    </button>
  ) : null;

  return (
    <>
      <VocabResult
        data={data}
        currentUser={user}
        headerAction={headerAction}
        controls={
          features.reextract ? (
            <ReextractPanel extraction={data} onUpdated={setData} />
          ) : null
        }
        savedMap={savedMap}
        onToggleSave={onToggleSave}
        savingKey={savingKey}
        onEditWord={features.edit ? setEditing : undefined}
      />
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

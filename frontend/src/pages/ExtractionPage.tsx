import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { useConfig } from "../ConfigContext";
import ReextractPanel from "../components/ReextractPanel";
import VocabResult from "../components/VocabResult";
import Toast from "../components/Toast";
import EditWordModal from "../components/EditWordModal";
import { useConfirm } from "../components/ConfirmProvider";
import type { ApiError, Extraction, Vocab, WordEditFields } from "../types";

export default function ExtractionPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { features, ready } = useConfig();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [data, setData] = useState<Extraction | null>(null);
  const [error, setError] = useState<string | null>(null); // fatal: load failed
  const [notice, setNotice] = useState<string | null>(null); // transient: action failed
  const [deleting, setDeleting] = useState(false);
  const [savedMap, setSavedMap] = useState<Map<string, number>>(new Map());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Vocab | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .extraction(id)
      .then(setData)
      .catch((e: ApiError) => setError(e.message || "Failed to load extraction"));
  }, [id]);

  const loadSavedWords = useCallback(() => {
    if (!user) return;
    api
      .savedWords()
      .then((res) => {
        const m = new Map<string, number>();
        for (const w of res.words) m.set(`${w.lemma}|${w.pos}`, w.id);
        setSavedMap(m);
      })
      .catch(() => {
        /* non-fatal; user just won't see saved state */
      });
  }, [user]);

  useEffect(() => {
    loadSavedWords();
  }, [loadSavedWords]);

  const onToggleSave = async (v: Vocab) => {
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
      setNotice((err as ApiError).message || "Couldn't update saved words.");
    } finally {
      setSavingKey(null);
    }
  };

  const onDelete = async () => {
    if (!data) return;
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
      setNotice((err as ApiError).message || "Couldn't delete the extraction.");
      setDeleting(false);
    }
  };

  const onSaveEdit = async (fields: WordEditFields) => {
    if (!editing || editing.id == null) return;
    setSavingEdit(true);
    try {
      const updated = await api.editVocab(id, editing.id, fields);
      setData(updated);
      // lemma/meaning may have changed → refresh the saved-state map.
      loadSavedWords();
      setEditing(null);
    } catch (err) {
      setNotice((err as ApiError).message || "Couldn't save the edit.");
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

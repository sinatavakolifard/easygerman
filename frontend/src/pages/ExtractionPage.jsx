import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import ReextractPanel from "../components/ReextractPanel.jsx";
import VocabResult from "../components/VocabResult.jsx";

export default function ExtractionPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [savedMap, setSavedMap] = useState(new Map());
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .extraction(id)
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load extraction"));
  }, [id]);

  useEffect(() => {
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
      setError(err.message || "Failed to update saved words");
    } finally {
      setSavingKey(null);
    }
  };

  const onDelete = async () => {
    if (
      !window.confirm(
        `Delete "${data.filename}"? The audio file and all extracted vocab will be removed. This can't be undone.`
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await api.deleteExtraction(id);
      navigate("/library");
    } catch (err) {
      setError(err.message || "Failed to delete extraction");
      setDeleting(false);
    }
  };

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p>Loading…</p>;

  const headerAction = (
    <button
      type="button"
      className="extraction-delete"
      onClick={onDelete}
      disabled={deleting}
    >
      {deleting ? "Deleting…" : "Delete extraction"}
    </button>
  );

  return (
    <VocabResult
      data={data}
      currentUser={user}
      headerAction={headerAction}
      controls={<ReextractPanel extraction={data} onUpdated={setData} />}
      savedMap={savedMap}
      onToggleSave={onToggleSave}
      savingKey={savingKey}
    />
  );
}

import { useEffect, useRef, useState } from "react";

// Modal form for editing a word's German (article + lemma), meaning, and
// example sentence + translation. `word` provides the initial values;
// `onSave(fields)` receives the trimmed fields; `onCancel` dismisses.
export default function EditWordModal({ word, onSave, onCancel, saving }) {
  const [article, setArticle] = useState(word.article || "");
  const [lemma, setLemma] = useState(word.lemma || "");
  const [meaning, setMeaning] = useState(word.meaning || "");
  const [example, setExample] = useState(word.example || "");
  const [exampleTranslation, setExampleTranslation] = useState(
    word.example_translation || ""
  );
  const [fieldError, setFieldError] = useState(null);
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKeyDown = (e) => {
      const { key } = e;
      if (key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const submit = (e) => {
    e.preventDefault();
    if (!lemma.trim()) {
      setFieldError("The word can't be empty.");
      return;
    }
    onSave({
      article: article.trim(),
      lemma: lemma.trim(),
      meaning: meaning.trim(),
      example: example.trim(),
      example_translation: exampleTranslation.trim(),
    });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Edit word"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="modal-title">Edit word</h2>
        <div className="modal-row">
          <label className="modal-field modal-field--sm">
            <span>Article</span>
            <input
              ref={firstRef}
              type="text"
              value={article}
              placeholder="der / die / das"
              onChange={(e) => setArticle(e.target.value)}
            />
          </label>
          <label className="modal-field">
            <span>Word</span>
            <input
              type="text"
              value={lemma}
              onChange={(e) => setLemma(e.target.value)}
            />
          </label>
        </div>
        <label className="modal-field">
          <span>Meaning</span>
          <input
            type="text"
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
          />
        </label>
        <label className="modal-field">
          <span>Example</span>
          <textarea
            rows="2"
            value={example}
            onChange={(e) => setExample(e.target.value)}
          />
        </label>
        <label className="modal-field">
          <span>Example translation</span>
          <textarea
            rows="2"
            value={exampleTranslation}
            onChange={(e) => setExampleTranslation(e.target.value)}
          />
        </label>
        {fieldError && <p className="modal-error">{fieldError}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="modal-btn modal-btn--primary"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

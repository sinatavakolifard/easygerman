import { useEffect, useState } from "react";
import { api } from "../api.js";

const FALLBACK_LEVELS = [
  { name: "A2+", max_zipf: 5.0 },
  { name: "B1+", max_zipf: 4.5 },
  { name: "B2+", max_zipf: 4.0 },
  { name: "C1+", max_zipf: 3.5 },
];

export default function ReextractPanel({ extraction, onUpdated }) {
  const [levels, setLevels] = useState(FALLBACK_LEVELS);
  const [defaultLevel, setDefaultLevel] = useState("B2+");
  const [level, setLevel] = useState("B2+");
  const [minCount, setMinCount] = useState(extraction.min_count ?? 1);
  const [top, setTop] = useState(extraction.top_k ?? 50);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.config().then((c) => {
      if (c.levels) setLevels(c.levels);
      if (c.default_level) {
        setDefaultLevel(c.default_level);
        setLevel(c.default_level);
      }
    }).catch(() => { /* keep fallback */ });
  }, []);

  // If the parent extraction object changes (e.g. after a successful
  // re-extract), sync the min/top defaults to its new values.
  useEffect(() => {
    setMinCount(extraction.min_count ?? 1);
    setTop(extraction.top_k ?? 50);
  }, [extraction.min_count, extraction.top_k]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const data = await api.reextract(extraction.extraction_id, {
        level,
        min_count: minCount,
        top,
      });
      onUpdated(data);
    } catch (err) {
      setError(err.message || "Re-extract failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <details className="reextract-panel">
      <summary>Re-extract with different settings</summary>
      {error && <p className="form-error">{error}</p>}
      <form onSubmit={onSubmit}>
        <div className="row">
          <label>
            <span>Difficulty</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              {levels.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
            <small>Default: {defaultLevel}.</small>
          </label>
          <label>
            <span>Min count</span>
            <input
              type="number"
              min={1}
              value={minCount}
              onChange={(e) => setMinCount(Number(e.target.value) || 1)}
            />
          </label>
          <label>
            <span>Top words</span>
            <input
              type="number"
              min={0}
              value={top}
              onChange={(e) => {
                const v = e.target.value;
                setTop(v === "" ? 0 : Math.max(0, Number(v) || 0));
              }}
            />
            <small>0 = no cap.</small>
          </label>
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? "Re-extracting…" : "Re-extract"}
        </button>
        <p className="hint">
          Re-runs the German→English translation, so it can take a minute. The
          audio and transcript stay; only the vocab list is replaced.
        </p>
      </form>
    </details>
  );
}

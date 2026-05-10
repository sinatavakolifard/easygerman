import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import VocabResult from "../components/VocabResult.jsx";

const FALLBACK_CONFIG = {
  models: ["tiny", "base", "small", "medium", "large-v3"],
  default_model: "small",
  default_min_count: 1,
  default_top: 50,
};

export default function IndexPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [config, setConfig] = useState(FALLBACK_CONFIG);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [anonResult, setAnonResult] = useState(null);

  useEffect(() => {
    api.config().then(setConfig).catch(() => {
      /* keep fallback */
    });
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const formData = new FormData(e.currentTarget);
      const data = await api.process(formData);
      if (data.extraction_id) {
        navigate(`/extraction/${data.extraction_id}`);
      } else {
        setAnonResult(data);
      }
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (anonResult) {
    return <VocabResult data={anonResult} currentUser={user} />;
  }

  return (
    <>
      <h1>Extract vocabulary</h1>
      <p className="lede">
        Upload a German podcast or audio clip, and get back the learning-worthy
        vocabulary with English translations.{" "}
        {user ? (
          "Your results are saved to your library."
        ) : (
          <>
            You can use the tool without an account, but the result won't be saved.{" "}
            <Link to="/signup">Sign up</Link> to keep a library you can revisit.
          </>
        )}
      </p>

      {error && <p className="form-error">{error}</p>}

      <form onSubmit={onSubmit}>
        <label className="file-field">
          <span>Audio file</span>
          <input
            type="file"
            name="audio"
            accept=".wav,.mp3,.m4a,.ogg,.flac,.mp4,.webm,audio/*"
            required
          />
        </label>

        <div className="row">
          <label>
            <span>Whisper model</span>
            <select name="model" defaultValue={config.default_model}>
              {config.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <small>Larger = more accurate, much slower.</small>
          </label>

          <label>
            <span>Min count</span>
            <input
              type="number"
              name="min_count"
              defaultValue={config.default_min_count}
              min={1}
            />
            <small>Drop words appearing fewer times.</small>
          </label>

          <label>
            <span>Top words</span>
            <input
              type="number"
              name="top"
              defaultValue={config.default_top}
              min={1}
            />
            <small>Cap on the result list size.</small>
          </label>
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? "Processing…" : "Extract vocabulary"}
        </button>
        <p className="hint">
          Transcription runs on this machine and can take several minutes — the page
          will update when it finishes.
        </p>
      </form>

      {submitting && (
        <div id="processing">
          <div className="spinner"></div>
          <p>Processing… transcribing, lemmatizing, and translating.</p>
        </div>
      )}
    </>
  );
}

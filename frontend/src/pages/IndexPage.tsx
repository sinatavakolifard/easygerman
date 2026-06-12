import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { useConfig } from "../ConfigContext";
import VocabResult from "../components/VocabResult";
import type { ApiError, Config, Extraction } from "../types";

type FormConfig = Pick<
  Config,
  | "models"
  | "default_model"
  | "default_min_count"
  | "default_top"
  | "levels"
  | "default_level"
>;

const FALLBACK_CONFIG: FormConfig = {
  models: ["tiny", "base", "small", "medium", "large-v3"],
  default_model: "small",
  default_min_count: 1,
  default_top: 50,
  levels: [
    { name: "A2+", max_zipf: 5.0 },
    { name: "B1+", max_zipf: 4.5 },
    { name: "B2+", max_zipf: 4.0 },
    { name: "C1+", max_zipf: 3.5 },
  ],
  default_level: "B2+",
};

export default function IndexPage() {
  const { user } = useAuth();
  const { config: loadedConfig, features, ready } = useConfig();
  const config: FormConfig = loadedConfig ?? FALLBACK_CONFIG;
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anonResult, setAnonResult] = useState<Extraction | null>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
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
      setError((err as ApiError).message || "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (anonResult) {
    return <VocabResult data={anonResult} currentUser={user} />;
  }

  // Wait for the real config before choosing form vs. disabled-notice, so a
  // read-only host doesn't flash the upload form for a few frames first.
  if (!ready) return null;

  if (!features.upload) {
    return (
      <>
        <h1>Extract vocabulary</h1>
        <p className="lede">
          Uploading new audio is disabled on this server.{" "}
          {user ? (
            <>
              You can still browse your <Link to="/library">library</Link> and{" "}
              <Link to="/saved">saved words</Link>.
            </>
          ) : (
            <>
              <Link to="/login">Log in</Link> to read your saved library and words.
            </>
          )}
        </p>
      </>
    );
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
            <span>Difficulty</span>
            <select name="level" defaultValue={config.default_level}>
              {config.levels.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
            <small>Skip words that are easier than this.</small>
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
              min={0}
            />
            <small>Cap on the result list size. 0 = no cap (all matching words).</small>
          </label>
        </div>

        <button type="submit" className="btn-primary" disabled={submitting}>
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

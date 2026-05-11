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

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .extraction(id)
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load extraction"));
  }, [id]);

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
    />
  );
}

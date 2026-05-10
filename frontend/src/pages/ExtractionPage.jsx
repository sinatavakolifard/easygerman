import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
import ReextractPanel from "../components/ReextractPanel.jsx";
import VocabResult from "../components/VocabResult.jsx";

export default function ExtractionPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .extraction(id)
      .then(setData)
      .catch((e) => setError(e.message || "Failed to load extraction"));
  }, [id]);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  return (
    <VocabResult
      data={data}
      currentUser={user}
      controls={<ReextractPanel extraction={data} onUpdated={setData} />}
    />
  );
}

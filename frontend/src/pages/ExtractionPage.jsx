import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../AuthContext.jsx";
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
      .then((d) =>
        setData({
          ...d,
          // Match the shape VocabResult expects.
          min_count: d.min_count,
          top_k: d.top_k,
        })
      )
      .catch((e) => setError(e.message || "Failed to load extraction"));
  }, [id]);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p>Loading…</p>;
  return <VocabResult data={data} currentUser={user} />;
}

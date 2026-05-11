// Thin wrapper around fetch — same-origin cookies, JSON helpers, multipart.

async function jsonFetch(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(opts.body && !(opts.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(opts.headers || {}),
    },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // empty body / non-JSON
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  config: () => jsonFetch("/api/config"),
  me: () => jsonFetch("/api/me"),
  signup: (email, password) =>
    jsonFetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email, password) =>
    jsonFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => jsonFetch("/api/auth/logout", { method: "POST" }),
  process: (formData) =>
    jsonFetch("/api/process", { method: "POST", body: formData }),
  library: () => jsonFetch("/api/library"),
  extraction: (id) => jsonFetch(`/api/extractions/${id}`),
  deleteExtraction: (id) =>
    jsonFetch(`/api/extractions/${id}`, { method: "DELETE" }),
  reextract: (id, params) =>
    jsonFetch(`/api/extractions/${id}/reextract`, {
      method: "POST",
      body: JSON.stringify(params),
    }),
  savedWords: () => jsonFetch("/api/saved-words"),
  saveWord: (word) =>
    jsonFetch("/api/saved-words", {
      method: "POST",
      body: JSON.stringify(word),
    }),
  deleteSavedWord: (id) =>
    jsonFetch(`/api/saved-words/${id}`, { method: "DELETE" }),
};

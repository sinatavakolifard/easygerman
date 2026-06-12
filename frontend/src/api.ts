// Thin wrapper around fetch — same-origin cookies, JSON helpers, multipart.

import type {
  AdminUser,
  ApiError,
  Config,
  Extraction,
  LibraryItem,
  ReextractParams,
  SaveWordInput,
  SavedWord,
  User,
  WordEditFields,
} from "./types";

async function jsonFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
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
  } catch {
    // fetch() rejects (rather than returning a response) when the network is
    // unreachable — surface a human message instead of the raw "NetworkError".
    const err = new Error(
      "You appear to be offline — check your connection and try again."
    ) as ApiError;
    err.offline = true;
    throw err;
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty body / non-JSON
  }
  if (!res.ok) {
    const body = data as { error?: string } | null;
    const err = new Error(
      (body && body.error) || `HTTP ${res.status}`
    ) as ApiError;
    err.status = res.status;
    err.data = body;
    throw err;
  }
  return data as T;
}

export const api = {
  config: () => jsonFetch<Config>("/api/config"),
  me: () => jsonFetch<{ user: User | null }>("/api/me"),
  signup: (email: string, password: string) =>
    jsonFetch<{ user: User }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    jsonFetch<{ user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => jsonFetch<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  process: (formData: FormData) =>
    jsonFetch<Extraction>("/api/process", { method: "POST", body: formData }),
  library: () => jsonFetch<{ extractions: LibraryItem[] }>("/api/library"),
  extraction: (id: string | number) =>
    jsonFetch<Extraction>(`/api/extractions/${id}`),
  deleteExtraction: (id: string | number) =>
    jsonFetch<{ ok: true }>(`/api/extractions/${id}`, { method: "DELETE" }),
  reextract: (id: string | number, params: ReextractParams) =>
    jsonFetch<Extraction>(`/api/extractions/${id}/reextract`, {
      method: "POST",
      body: JSON.stringify(params),
    }),
  editVocab: (
    extractionId: string | number,
    entryId: number,
    fields: WordEditFields
  ) =>
    jsonFetch<Extraction>(`/api/extractions/${extractionId}/vocab/${entryId}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    }),
  editSavedWord: (id: number, fields: WordEditFields) =>
    jsonFetch<{ word: SavedWord }>(`/api/saved-words/${id}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    }),
  savedWords: () => jsonFetch<{ words: SavedWord[] }>("/api/saved-words"),
  saveWord: (word: SaveWordInput) =>
    jsonFetch<{ id: number; lemma: string; pos: string }>("/api/saved-words", {
      method: "POST",
      body: JSON.stringify(word),
    }),
  deleteSavedWord: (id: number) =>
    jsonFetch<{ ok: true }>(`/api/saved-words/${id}`, { method: "DELETE" }),
  adminUsers: () => jsonFetch<{ users: AdminUser[] }>("/api/admin/users"),
  adminDeleteUser: (id: number) =>
    jsonFetch<{ ok: true }>(`/api/admin/users/${id}`, { method: "DELETE" }),
  adminSetAdmin: (id: number, isAdmin: boolean) =>
    jsonFetch<{ ok: true; is_admin: boolean }>(`/api/admin/users/${id}/admin`, {
      method: "POST",
      body: JSON.stringify({ is_admin: isAdmin }),
    }),
  adminResetPassword: (id: number, password: string) =>
    jsonFetch<{ ok: true }>(`/api/admin/users/${id}/password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
};

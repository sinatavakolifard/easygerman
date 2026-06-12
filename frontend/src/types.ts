// Shared domain types — mirror the JSON shapes the Flask API returns.

export type Theme = "dark" | "light";

export interface User {
  id: number;
  email: string;
  is_admin: boolean;
}

export interface Level {
  name: string;
  max_zipf: number;
}

export interface Features {
  upload: boolean;
  audio: boolean;
  reextract: boolean;
  delete: boolean;
  edit: boolean;
}

export interface Config {
  models: string[];
  default_model: string;
  default_min_count: number;
  default_top: number;
  levels: Level[];
  default_level: string;
  allowed_extensions: string[];
  features: Features;
}

export interface Vocab {
  /** vocab_entries row id — present on stored extractions, absent on anonymous results. */
  id?: number;
  lemma: string;
  pos: string;
  count: number;
  article: string;
  meaning: string;
  example: string;
  example_translation: string;
  display: string;
}

export interface Extraction {
  /** null for an anonymous (unsaved) result. */
  extraction_id: number | null;
  filename: string;
  model: string;
  min_count: number;
  top_k: number;
  transcript: string;
  audio_token: string;
  created_at?: string;
  vocab: Vocab[];
  anonymous: boolean;
}

export interface LibraryItem {
  id: number;
  filename: string;
  model: string;
  created_at: string;
  word_count: number;
}

export interface SavedWord {
  id: number;
  lemma: string;
  pos: string;
  article: string;
  meaning: string;
  example: string;
  example_translation: string;
  source_filename: string;
  saved_at: string;
}

export interface AdminUser {
  id: number;
  email: string;
  created_at: string;
  is_admin: boolean;
  extraction_count: number;
  saved_count: number;
}

/** The editable fields shared by a vocab entry and a saved word. */
export interface WordEditFields {
  article: string;
  lemma: string;
  meaning: string;
  example: string;
  example_translation: string;
}

/** Anything that can populate the edit modal (a Vocab or a SavedWord). */
export interface EditableWord {
  article?: string;
  lemma: string;
  meaning?: string;
  example?: string;
  example_translation?: string;
}

export interface ReextractParams {
  level: string;
  min_count: number;
  top: number;
}

export interface SaveWordInput {
  lemma: string;
  pos: string;
  article?: string;
  meaning?: string;
  example?: string;
  example_translation?: string;
  source_filename?: string;
}

/** Error thrown by the api layer (see api.ts). */
export interface ApiError extends Error {
  status?: number;
  data?: { error?: string } | null;
  offline?: boolean;
}

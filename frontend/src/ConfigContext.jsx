import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

// Feature flags come from GET /api/config (set per-machine via env vars on
// the backend). Default to everything enabled so the full-featured host — and
// the brief moment before config loads — shows the complete UI; a restricted
// host flips the relevant flags off once the fetch resolves.
const DEFAULT_FEATURES = {
  upload: true,
  audio: true,
  reextract: true,
  delete: true,
};

const ConfigContext = createContext({
  config: null,
  features: DEFAULT_FEATURES,
});

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    api.config().then(setConfig).catch(() => {
      /* keep null → DEFAULT_FEATURES */
    });
  }, []);

  const features = { ...DEFAULT_FEATURES, ...(config?.features || {}) };

  return (
    <ConfigContext.Provider value={{ config, features }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigContext);
}

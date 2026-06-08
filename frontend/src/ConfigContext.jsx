import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

// Feature flags come from GET /api/config (set per-machine via env vars on
// the backend). Default to everything enabled, but expose `ready` so callers
// can wait for the real config before rendering gated UI — otherwise a
// restricted host briefly shows the full UI (e.g. the upload form) and then
// hides it once the fetch resolves, which reads as a flash.
const DEFAULT_FEATURES = {
  upload: true,
  audio: true,
  reextract: true,
  delete: true,
};

const ConfigContext = createContext({
  config: null,
  features: DEFAULT_FEATURES,
  ready: false,
});

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .config()
      .then((c) => {
        if (active) setConfig(c);
      })
      .catch(() => {
        /* keep null → DEFAULT_FEATURES */
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const features = { ...DEFAULT_FEATURES, ...(config?.features || {}) };

  return (
    <ConfigContext.Provider value={{ config, features, ready }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigContext);
}

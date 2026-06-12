import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { Config, Features } from "./types";

// Feature flags come from GET /api/config (set per-machine via env vars on
// the backend). Default to everything enabled, but expose `ready` so callers
// can wait for the real config before rendering gated UI — otherwise a
// restricted host briefly shows the full UI (e.g. the upload form) and then
// hides it once the fetch resolves, which reads as a flash.
const DEFAULT_FEATURES: Features = {
  upload: true,
  audio: true,
  reextract: true,
  delete: true,
  edit: true,
};

interface ConfigContextValue {
  config: Config | null;
  features: Features;
  ready: boolean;
}

const ConfigContext = createContext<ConfigContextValue>({
  config: null,
  features: DEFAULT_FEATURES,
  ready: false,
});

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
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

  const features: Features = { ...DEFAULT_FEATURES, ...(config?.features || {}) };

  return (
    <ConfigContext.Provider value={{ config, features, ready }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  return useContext(ConfigContext);
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { MotionConfig } from "motion/react";

export type Density = "comfortable" | "compact";
export type MotionPreference = "enabled" | "reduced";

type Preferences = { density: Density; motion: MotionPreference };

const DEFAULTS: Preferences = { density: "comfortable", motion: "enabled" };
const STORAGE_KEY = "engsoc-admin-preferences";

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: Preferences } = {
  raw: null,
  value: DEFAULTS,
};

function read(): Preferences {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return DEFAULTS;
  }
  if (raw === cached.raw) return cached.value;
  let value = DEFAULTS;
  try {
    const parsed = raw ? JSON.parse(raw) : {};
    value = {
      density: parsed.density === "compact" ? "compact" : "comfortable",
      motion: parsed.motion === "reduced" ? "reduced" : "enabled",
    };
  } catch {
    value = DEFAULTS;
  }
  cached = { raw, value };
  return value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const PreferencesContext = createContext<{
  preferences: Preferences;
  setPreference: <K extends keyof Preferences>(
    key: K,
    value: Preferences[K]
  ) => void;
} | null>(null);

/**
 * Device-local interface preferences for the admin workspace. They live in
 * this browser's localStorage only — no account data, no database — and are
 * applied as `data-density` / `data-motion` attributes on the shell.
 */
export function AdminPreferencesProvider({
  children,
}: {
  children: (state: Preferences) => ReactNode;
}) {
  const preferences = useSyncExternalStore(subscribe, read, () => DEFAULTS);

  const setPreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      const next = { ...read(), [key]: value };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage blocked: keep the in-memory value for this tab only.
        cached = { raw: JSON.stringify(next), value: next };
      }
      listeners.forEach((listener) => listener());
    },
    []
  );

  const context = useMemo(
    () => ({ preferences, setPreference }),
    [preferences, setPreference]
  );

  return (
    <PreferencesContext.Provider value={context}>
      <MotionConfig
        reducedMotion={preferences.motion === "reduced" ? "always" : "user"}
      >
        {children(preferences)}
      </MotionConfig>
    </PreferencesContext.Provider>
  );
}

export function useAdminPreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error(
      "useAdminPreferences must be used inside AdminPreferencesProvider"
    );
  }
  return context;
}

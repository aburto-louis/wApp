/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin. Leave unset to call the same origin via /api. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

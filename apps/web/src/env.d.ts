/// <reference types="vite/client" />

/** Build-time configuration (spec 01 § Environments). Nothing here is secret. */
interface ImportMetaEnv {
  /** The realtime Worker, e.g. https://sannidhi-realtime-staging.<account>.workers.dev */
  readonly VITE_REALTIME_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

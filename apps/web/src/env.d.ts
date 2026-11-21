/// <reference types="vite/client" />

/** Build-time configuration (spec 01 § Environments). Nothing here is secret. */
interface ImportMetaEnv {
  /** The realtime Worker, e.g. https://sannidhi-realtime-staging.<account>.workers.dev */
  readonly VITE_REALTIME_URL?: string;
  /** Where built models are served (spec 11). Empty: the app's own origin, under /v/. */
  readonly VITE_ASSET_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

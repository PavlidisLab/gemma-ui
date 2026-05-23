/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEMMA_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Resolved upstream URL the dev/build-time proxy targets. Injected
 *  by Vite via ``define`` (see vite.config.ts) from
 *  ``GEMMA_BASE_URL``, defaulting to staging. Surfaced in the
 *  footer so the curator always knows which API they're hitting. */
declare const __GEMMA_TARGET__: string;

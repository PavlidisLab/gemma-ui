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

/** Short git commit SHA at build time. "dev" outside a git checkout. */
declare const __GEMMA_BUILD_SHA__: string;
/** Full 40-char git commit SHA — used to deep-link to GitHub. */
declare const __GEMMA_BUILD_SHA_FULL__: string;
/** ISO 8601 build timestamp. */
declare const __GEMMA_BUILD_TIME__: string;

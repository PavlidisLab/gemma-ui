/// <reference types="vite/client" />

// Project-specific build-time env typing. Vite only inlines vars
// prefixed with ``VITE_``; anything else read here at runtime is
// undefined in the bundle. The ``GEMMA_CURATION_URL`` placeholder
// (no prefix) at App.tsx:198 was previously dead code for exactly
// this reason — it always read undefined and the footer fell
// through to its "/rest (proxied)" branch.

interface ImportMetaEnv {
  /** Optional override for the Gemma curation API base. When unset,
   *  the app talks to the Vite-proxied ``/rest/v2`` (the dev mock
   *  on localhost:8080). Set this only when pointing the deployed
   *  UI at a non-proxied backend. */
  readonly VITE_GEMMA_CURATION_URL?: string;
  /** Static dev-token fallback for un-logged-in API calls. Only
   *  set during local mock development; never ship a real token in
   *  this var (it's inlined into the public bundle). */
  readonly VITE_GEMMA_CURATION_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

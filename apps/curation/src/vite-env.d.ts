/// <reference types="vite/client" />

// Project-specific build-time env typing. Vite only inlines vars
// prefixed with ``VITE_``; anything else read here at runtime is
// undefined in the bundle. The ``GEMMA_CURATION_URL`` placeholder
// (no prefix) at App.tsx:198 was previously dead code for exactly
// this reason — it always read undefined and the footer fell
// through to its "/rest (proxied)" branch.

interface ImportMetaEnv {
  /** Optional override for the Gemma curation API base. When unset,
   *  the app talks to the Vite-proxied ``/rest/v2`` (the local
   *  curation server on localhost:8080). Set this only when pointing
   *  the deployed UI at a non-proxied backend. */
  readonly VITE_GEMMA_CURATION_URL?: string;
  /** Static dev-token fallback for un-logged-in API calls. Only
   *  set during local-server development; never ship a real token
   *  in this var (it's inlined into the public bundle). */
  readonly VITE_GEMMA_CURATION_API_KEY?: string;
  /** Which backend mode the UI is configured for:
   *    - ``"local"`` (default): the standalone curation server on
   *      localhost:8080 (or the proxy). Auth: ``dev-token-123``.
   *      Full capability set — audits, dispositions, design edits.
   *    - ``"remote"``: real Gemma at ``VITE_GEMMA_BASE_URL``. Auth:
   *      HTTP Basic with the curator's Gemma credentials. Narrow
   *      capability set; read-mostly. Confirmation modals fire on
   *      every write.
   *  Read at boot via ``useGemmaMode()``. See
   *  ``gemma-curation-agents-eval/docs/HANDOFF_2026-05-19_LOCAL_VS_REMOTE_MODE.md``. */
  readonly VITE_GEMMA_MODE?: "local" | "remote";
  /** Absolute URL of the backend (only consulted by ``useGemmaMode``
   *  to render the mode chip and to bypass the Vite proxy in remote
   *  mode). Defaults to ``http://localhost:8080`` in local mode.
   *  For remote, set to e.g. ``https://staging-gemma.msl.ubc.ca`` or
   *  ``https://gemma.msl.ubc.ca``. */
  readonly VITE_GEMMA_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

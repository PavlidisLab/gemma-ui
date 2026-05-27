/**
 * Re-export from ``@gemma/ui``. The implementation moved into the
 * shared UI package on 2026-05-26 so the browser app can use the
 * same border-trick spinner without duplicating it. The file path
 * stays put as a thin shim — every existing caller's
 * ``import { Spinner } from "@/components/ui/Spinner"`` keeps
 * working without a churn pass.
 */
export { Spinner } from "@gemma/ui";

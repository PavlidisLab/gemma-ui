# `run_mock.sh --reload` paper cuts

Filed 2026-05-08 from a dev session.

## Two paper cuts on `--reload` usage

Paul tried `./run_mock.sh --reload` and hit:

1. **Keychain GUI dialog re-prompts** because uvicorn's reload mode
   re-spawns the worker subprocess and the `security
   find-generic-password` call keeps coming back. The script today
   queries keychain unconditionally even when
   `GEMMA_CURATION_API_KEY` is already in the env.

2. **No default port** when args are present. Today's logic:

   ```bash
   PORT_ARGS=()
   if [ "$#" -eq 0 ]; then
       PORT_ARGS=(--port 8080)
   fi
   ```

   `./run_mock.sh --reload` has `$# == 1`, so PORT_ARGS stays empty
   and the CLI falls back to its own default (not 8080).
   Workaround today: `./run_mock.sh --reload --port 8080`.

## Suggested fix (one shell-script edit)

```bash
# Prefer a pre-set GEMMA_CURATION_API_KEY over a keychain query —
# avoids the macOS keychain GUI prompt that re-fires when uvicorn
# reload re-spawns the worker.
if [ -z "${GEMMA_CURATION_API_KEY:-}" ]; then
    if ! keychain_export GEMMA_CURATION_API_KEY \
            "GEMMA_CURATION_API_KEY" "gemma-curation-api-key"; then
        export GEMMA_CURATION_API_KEY="${GEMMA_CURATION_API_KEY:-dev-token-123}"
        echo "[run_mock] no keychain entry; using GEMMA_CURATION_API_KEY=$GEMMA_CURATION_API_KEY" >&2
    fi
else
    echo "[run_mock] GEMMA_CURATION_API_KEY already set; skipping keychain" >&2
fi

# Default port to 8080 unless the caller explicitly passed --port.
PORT_ARGS=()
case " $* " in
    *" --port "*) ;;       # caller set port; respect it.
    *) PORT_ARGS=(--port 8080) ;;
esac
```

Same shape on `run_proposer_service.sh` if the keychain issue
hits there too on `--reload`.

## Cross-repo compatibility

Pure shell-script change; no schema or wire impact. UI side
unchanged.

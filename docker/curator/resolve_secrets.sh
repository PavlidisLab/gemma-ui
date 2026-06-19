#!/usr/bin/env bash
# Cross-platform credential resolver.
#
# Sourced by ``import-all.sh`` and any other curator-side host
# script that needs a credential before invoking ``docker compose
# exec`` (which only forwards env vars present at compose-up time
# and can't reach the host's secret store from inside the
# container).
#
# Resolution order — keychain FIRST, env-var fallback:
#
#   1. **Keychain** (whichever is available on this OS):
#      * macOS:   ``security find-generic-password -s <entry> -w``
#      * Linux:   ``secret-tool lookup service <entry>``
#                  (provided by ``libsecret-tools`` — install
#                  if curator uses GNOME / KDE Secret Service)
#      * Windows: ``cmdkey`` + a PowerShell shim for the value
#                  (works under WSL / Git Bash with PowerShell on PATH)
#   2. **Environment variable** already exported in the calling shell.
#   3. **``.env`` file** in the curator dir (read via standard
#      docker-compose ``--env-file`` semantics; not done here —
#      docker-compose already does this when the wrapper calls it).
#
# Failure mode is loud, not silent: ``resolve_secret`` echoes the
# resolved value to stdout and exits 0 on hit; exits 1 with a
# stderr message naming the var + the keychain entries tried on
# miss.
#
# Usage:
#   source resolve_secrets.sh
#   if val=$(resolve_secret GEMMA_CURATION_API_KEY \
#               "GEMMA_CURATION_API_KEY" "gemma-curation-api-key"); then
#       export GEMMA_CURATION_API_KEY="$val"
#   else
#       echo "No GEMMA_CURATION_API_KEY found — see README." >&2
#       exit 1
#   fi
#
# Adding to keychain (curator-facing setup):
#
#   macOS:
#     security add-generic-password -s GEMMA_CURATION_API_KEY \
#       -a "$USER" -w '<the-value>'
#
#   Linux (GNOME Keyring / KDE Wallet via Secret Service):
#     secret-tool store --label='Gemma curation API key' \
#       service GEMMA_CURATION_API_KEY
#     # prompts for the value, stored under service=GEMMA_CURATION_API_KEY
#
#   Windows (PowerShell):
#     cmdkey /generic:GEMMA_CURATION_API_KEY /user:gemma \
#       /pass:<the-value>

# Returns 0 + echoes value on hit, 1 + stderr msg on miss.
resolve_secret() {
    local var_name="$1"; shift
    local entries=("$@")

    # ------------------------------------------------------------
    # 1. Keychain — try every named entry on every available backend.
    # ------------------------------------------------------------

    # macOS Keychain.
    if command -v security >/dev/null 2>&1; then
        for entry in "${entries[@]}"; do
            [ -z "$entry" ] && continue
            local val
            if val=$(security find-generic-password -s "$entry" -w \
                     2>/dev/null); then
                if [ -n "$val" ]; then
                    printf '%s' "$val"
                    return 0
                fi
            fi
        done
    fi

    # Linux Secret Service (GNOME Keyring / KDE Wallet).
    if command -v secret-tool >/dev/null 2>&1; then
        for entry in "${entries[@]}"; do
            [ -z "$entry" ] && continue
            local val
            if val=$(secret-tool lookup service "$entry" 2>/dev/null); then
                if [ -n "$val" ]; then
                    printf '%s' "$val"
                    return 0
                fi
            fi
        done
    fi

    # Windows Credential Manager (cmdkey is read-only via PS-shim).
    # WSL / Git Bash on Windows can reach powershell.exe via PATH.
    if command -v powershell.exe >/dev/null 2>&1; then
        for entry in "${entries[@]}"; do
            [ -z "$entry" ] && continue
            # CredentialManager module path: requires installing
            # `Install-Module CredentialManager -Scope CurrentUser`
            # once (PowerShell). Tip is in the curator README.
            local ps_cmd
            ps_cmd="\$c = Get-StoredCredential -Target '$entry' "
            ps_cmd+="-ErrorAction SilentlyContinue; "
            ps_cmd+="if (\$c) { \$c.GetNetworkCredential().Password }"
            local val
            val=$(powershell.exe -NoProfile -Command "$ps_cmd" 2>/dev/null \
                  | tr -d '\r\n') || true
            if [ -n "$val" ]; then
                printf '%s' "$val"
                return 0
            fi
        done
    fi

    # ------------------------------------------------------------
    # 2. Already-exported environment variable.
    # ------------------------------------------------------------
    if [ -n "${!var_name:-}" ]; then
        printf '%s' "${!var_name}"
        return 0
    fi

    # ------------------------------------------------------------
    # Miss — loud failure with platform-specific guidance.
    # ------------------------------------------------------------
    {
        echo "[resolve_secret] no value for ${var_name}"
        echo "  Tried keychain entries: ${entries[*]}"
        echo "  Then env var: ${var_name} (unset)"
        echo ""
        echo "  Add to keychain (one-time):"
        if command -v security >/dev/null 2>&1; then
            echo "    macOS:   security add-generic-password "
            echo "             -s ${entries[0]} -a \"\$USER\" -w '<value>'"
        fi
        if command -v secret-tool >/dev/null 2>&1; then
            echo "    Linux:   secret-tool store --label='${var_name}' "
            echo "             service ${entries[0]}"
        fi
        if command -v powershell.exe >/dev/null 2>&1; then
            echo "    Windows: cmdkey /generic:${entries[0]} /user:gemma "
            echo "             /pass:<value>"
        fi
        echo ""
        echo "  Or export ${var_name}=<value> in the shell that "
        echo "  runs ./import-all.sh"
    } >&2
    return 1
}

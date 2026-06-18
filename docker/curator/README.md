# Curator laptop stack

Self-contained docker compose curators run on their laptop to review
calibration / evaluation packages. Mac, Windows, Linux — same stack.

## What runs

| service | image | host port | role |
|---|---|---|---|
| `curation-ui` | `gemma-curator/curation-ui` | `:5175` | nginx serving the built SPA + proxying `/rest`, `/propose`, `/audit`, `/find-*` to the backends below |
| `local-api` | `gemma-curator/local-api` | (internal only) | FastAPI for the curation backend; calibration packages live in its SQLite |
| `proposer` (optional, `--profile agents`) | `gemma-curator/local-api` (re-used) | (internal only) | LLM-backed proposer for fresh proposals / audits; needs `ANTHROPIC_API_KEY` |

Real Gemma 2.0 is **off-site** — the `proposer` calls it via the
`GEMMA_BASE_URL` env. The curator's stack itself doesn't bundle
Gemma 2.0.

## What hits the network (and what doesn't)

The curator's review flow is mostly self-contained against the
local-api. The only routine network dependency is **ontology
typeahead** — the term picker queries an external annotation index
to surface MONDO / UBERON / CL / EFO terms beyond the small
built-in catalog. That endpoint is configurable:

* **`GEMMA_ONTOLOGY_URL`** points local-api's `/rest/v2/annotations/search` + `/annotations/term`
  at any reachable host. During the transition period this is
  `staging-gemma.msl.ubc.ca`; once the new gemma-rest 2.0 server is
  up, point it there. **Leave unset** to fall back to local-api's
  built-in catalog (works but the term picker narrows badly outside
  the recurring value-strings).

Other state the curator doesn't need to fetch live:

| capability | where it comes from |
|---|---|
| factor / FV / tag proposals | the imported calibration package |
| disposition + finalize | local-api → SQLite (in the persistent volume) |
| QuantitationTypes per experiment | the snapshot cache the calibration import populated (no remote fetch needed) |
| `gene knockdown`, `wild type genotype`, etc. | bundled `value_string_mappings.tsv` (in the local-api image) |

If `GEMMA_ONTOLOGY_URL` is unreachable, the typeahead degrades to
the local catalog automatically — the rest of the review surface
keeps working.

## Curator setup (the deliverable)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop) (mac/win) or Docker Engine (linux).
2. Get this `curator/` folder (zip / git clone) — and the calibration package(s) into `./calibration-packages/`.
3. `cp .env.example .env` — edit `GEMMA_ONTOLOGY_URL` if a non-default ontology host is preferred.
4. `docker compose pull` (or `docker compose up --build` if a registry isn't set up yet).
5. **`./start.sh`** (not `docker compose up -d` directly — see "Credentials" below).
6. **Import the calibration packages — `./import-all.sh`** (mandatory; UI is blank without this).
7. Open <http://localhost:5175/>.

To load a calibration package:

```sh
# Easy path — imports every package in ./calibration-packages/:
./import-all.sh
```

Or one package at a time:

```sh
docker compose exec local-api python /calibration-packages/<package-dir>/setup.py --base-url http://local-api:8000
```

Or wipe + reload:

```sh
docker compose exec local-api gca mock-gemma reset-curation
./import-all.sh
```

State persists in the `local-api-data` docker volume.
`docker compose down` keeps it; `docker compose down -v` nukes it.

## Building the images (dev — not for curators)

Curators don't build; they pull. Devs build once and publish to a
registry curators can `docker compose pull` from.

```sh
# from this folder, with ~/Dev/gemma-curation-agents checked out parallel
./build.sh                                  # tag=latest
TAG=v0.10.0 ./build.sh
```

Then push to whatever registry bro publishes to:

```sh
docker tag gemma-curator/local-api:latest <registry>/gemma-curator/local-api:latest
docker push <registry>/gemma-curator/local-api:latest
# (same for curation-ui)
```

Update `LOCAL_API_IMAGE` / `CURATION_UI_IMAGE` in `.env.example` to
point at the registry path.

## Enabling the proposer (fresh proposals)

Curators reviewing pre-built calibration packages don't need this —
all the proposal + audit content is already in the package. To run
the LLM-backed proposer locally too:

```sh
# Set ANTHROPIC_API_KEY in .env first
docker compose --profile agents up -d
```

## Credentials (cross-platform keychain integration)

Two scripts handle credential resolution on the **host** so the
container always sees the right value:

| script | when to use | what it does |
|---|---|---|
| `./start.sh` | replaces `docker compose up -d` | resolves keys on host, exports, then `docker compose up -d $@` |
| `./import-all.sh` | after `start.sh`, to load packages | resolves keys on host, passes to setup.py via `--api-key` |

Both source `./resolve_secrets.sh`, which checks (in order):

1. **Keychain** — whichever is available on the curator's OS:
   * macOS: `security find-generic-password`
   * Linux: `secret-tool lookup` (install `libsecret-tools` first)
   * Windows: `powershell.exe` + the `CredentialManager` PS module
2. **Environment variable** already exported in the calling shell.

If neither is set, the local-api falls back to the public
`dev-token-123` default, which works for fresh handoffs but breaks
once the lab rotates the bearer.

### Adding the key to keychain (one-time setup)

**macOS:**

```sh
security add-generic-password -s GEMMA_CURATION_API_KEY \
  -a "$USER" -w '<the-value>'
```

**Linux** (GNOME Keyring / KDE Wallet via Secret Service):

```sh
sudo apt install libsecret-tools     # or your distro's package
secret-tool store --label='Gemma curation API key' \
  service GEMMA_CURATION_API_KEY
# prompts for the value
```

**Windows** (PowerShell, once per machine):

```powershell
Install-Module CredentialManager -Scope CurrentUser -Force
New-StoredCredential -Target GEMMA_CURATION_API_KEY -UserName gemma `
  -Password '<the-value>' -Persist LocalMachine
```

After this, `./start.sh` and `./import-all.sh` will both pick the
value up automatically — same behaviour on every OS.

### Optional: Anthropic key for the proposer profile

`./start.sh` also tries to resolve `ANTHROPIC_API_KEY` (needed only
when running with `--profile agents`). Add it the same way:

```sh
# macOS
security add-generic-password -s ANTHROPIC_API_KEY \
  -a "$USER" -w 'sk-ant-...'
```

The script tries several common entry names (`ANTHROPIC_API_KEY`,
`anthropic`, `anthropic-api-key`) so existing keychain entries from
other tools usually just work.

## Cross-platform notes

- **Windows**: works under WSL2-backed Docker Desktop. The
  `./calibration-packages` bind-mount maps to your WSL filesystem;
  drop packages there from inside WSL for fastest IO.
- **Linux**: works native. If you're not in the `docker` group,
  prefix commands with `sudo` or `sudo -E` (the `-E` carries
  env vars from `.env` resolution).
- **Mac**: Docker Desktop default. SQLite + calibration package
  reads should be fine but very large packages can be slow because
  of macOS bind-mount overhead — for now, calibration packages are
  small enough not to matter.

## Versus the dev stack

This is the **distributable** stack. The `../local-mode/` sibling
is the **dev-iteration** stack — bind-mounts source from the host so
Python + TS edits land instantly. Use that when you're modifying the
agents repo or the curation UI; use this when you're packaging for
curators.

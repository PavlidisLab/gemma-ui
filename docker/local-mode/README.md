# local-mode docker stack

One-command containerized "local mode" for the curation flow.

## What it runs

| service | image | host port | role |
|---|---|---|---|
| `local-api` | `gemma-local-mode/agents:dev` (built from `Dockerfile.agents`) | `:8095` | Curation backend (FastAPI, `gca mock-gemma serve`). Hosts the SQLite that calibration packages load into. |
| `proposer` | same image, different command | `:8082` | Long-running FastAPI for `/propose`, `/audit`, `/find-*`. |
| `curation-ui` | `gemma-local-mode/curation-ui:dev` (built from `Dockerfile.curation-ui`) | `:5175` | Vite dev server for `apps/curation/`. Talks to the two services over the compose network. |
| `browser-ui` | `gemma-local-mode/browser-ui:dev` (built from `Dockerfile.browser`) | `:5183` | Vite dev server for `apps/browser/` (GemBrow React port). Talks to Gemma 2.0 REST on the host (`host.docker.internal:8080` by default; override via `GEMMA_BROWSER_BACKEND`). |
| `gemma-rest` (optional) | `tomcat:10.1-jdk25-temurin` | `:8080` | Gemma 2.0 REST. Bind-mounts the WAR from the host. Brought up with `--gemma`. |
| `gemma-db` (optional) | `mysql:8.0` | `:3306` | MySQL backing Gemma 2.0. Brought up with `--gemma`. |

Bind mounts keep iteration fast — Python + TS edits on the host
take effect inside the container without rebuild. `node_modules`
lives on a named volume so macOS vs. Linux compiled binaries don't
clash.

## Run

```sh
./up.sh                  # core stack (local-api + proposer + curation-ui)
./up.sh --gemma          # also bring up Gemma 2.0 + MySQL (Linux-friendly)
./up.sh --gemma --build  # rebuild images before up
```

Then visit:
- **http://localhost:5175/** — curation UI
- **http://localhost:5183/** — browser UI (GemBrow React port)

`up.sh` resolves `ANTHROPIC_API_KEY`, `GEMMA_CURATION_API_KEY`,
`GEMMA_BASE_URL`, `GEMMA_USERNAME` / `GEMMA_PASSWORD`, and optional
Zotero creds from the macOS Keychain (same pattern as `run_local.sh` /
`run_proposer_service.sh`). Pre-set env vars override the keychain
lookup.

🛑 **`GEMMA_USERNAME` / `GEMMA_PASSWORD` must match whichever Gemma
`GEMMA_BASE_URL` points at.** They default to `groupadmin`, which
exists only in local-mode's own gemma-rest (seeded by
`groupadmin-seed.sql`). Point the host at a real Gemma while leaving
the account on that default and every upstream call the agent makes
answers `401 Provided authentication credentials are invalid` — drafts
do not save and locks do not take. The UI reports it as
`save failed: 401`, which reads like your own session expiring, so
check this pairing first. `up.sh` prints it on startup:

```
[up] gemma: https://gemma2.msl.ubc.ca as administrator
```

Stash the pair once and it resolves on every run:

```sh
security add-generic-password -s GEMMA_USERNAME -a "$USER" -w '<username>'
security add-generic-password -s GEMMA_PASSWORD -a "$USER" -w '<password>'
```

Writes stay off regardless: mutating Gemma calls also need
`GEMMA_WRITE_TARGET` set to the URL being written to.

🛑 **`VITE_GEMMA_MODE` is not resolved from anywhere** — it is inlined
into the SPA at container start and comes only from the invoking shell,
so a bare `./up.sh` rebuilds the UI in **local** mode no matter what the
rest of the stack is pointed at. Local mode serves a synthetic curator,
so the header reads "Local Curator" and there is no login form. For the
real login against your Gemma:

```sh
VITE_GEMMA_MODE=remote ./up.sh     # base follows GEMMA_BASE_URL
```

`up.sh` prints which one it built, and warns when a local-mode UI ends
up in front of a keychain Gemma.

🛑 **Naming a Gemma is not routing to one.** `VITE_GEMMA_BASE_URL` is
what the mode chip and login page *say*; `GEMMA_REST_URL` is where the
proxy *sends* `/rest`. Set one and not the other and remote mode posts
every login to the unset one's default — `host.docker.internal:8080` —
and vite answers `POST /rest/v2/login failed: 500` from a page naming a
host it never contacted. `up.sh` now derives both from `GEMMA_BASE_URL`
and prints each, so one keychain entry configures the whole stack.

```sh
./down.sh            # stop + remove containers
./down.sh --volumes  # also nuke ui-node-modules / gemma-db-data
```

## Required env / paths

| env | default | notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | keychain | required for proposer |
| `GEMMA_CURATION_API_KEY` | keychain → `dev-token-123` | bearer accepted by local_api |
| `AGENTS_REPO` | `../../../gemma-curation-agents` | bind-mount source for the Python services |
| `UI_REPO` | `../..` | bind-mount source for the curation UI |
| `GEMMA_WAR_PATH` | `${HOME}/gemma/gemma-rest/target/gemma-rest.war` | only with `--gemma`; the WAR file Tomcat hosts. Point at your Gemma checkout |
| `GEMMA_DB_NAME` / `GEMMA_DB_USER` / `GEMMA_DB_PASSWORD` / `GEMMA_DB_ROOT_PASSWORD` | `gemd` / `gemmaadmin` / `gemmatoast` / `gemmatoast` | MySQL creds — match what the WAR expects |
| `GEMMA_DB_SEED_DIR` | `./seed-empty` (empty) | drop `.sql.gz` files here for first-boot DB import |
| `GEMMA_BASE_URL` | none — **required** | read-side Gemma for the proposer. Set to your own Gemma instance, or `http://gemma-rest:8080` when running `--gemma` |
| `GEMMA_USERNAME` / `GEMMA_PASSWORD` | keychain → `groupadmin` / `groupadmin` | account the proposer + local-api authenticate to Gemma WITH. The default is the local-mode seed account and works only with `--gemma`; any other `GEMMA_BASE_URL` needs a real account or every upstream call 401s |
| `GEMMA_WRITE_TARGET` | unset | must equal the Gemma URL being written to before any mutating call is allowed. Leave unset for read-only work |
| `VITE_GEMMA_MODE` | unset → `local` | `remote` for the real login + Gemma-only surfaces; `local` serves a synthetic curator and the store-backed surfaces. Shell only — no keychain, no compose default |
| `VITE_GEMMA_BASE_URL` | `GEMMA_BASE_URL` | Gemma the SPA names in the mode chip and the login page. Required by remote mode, which refuses to default it |
| `GEMMA_REST_URL` | `GEMMA_BASE_URL` → `http://host.docker.internal:8080` | where the UI's vite proxy actually SENDS `/rest`. Naming a host in `VITE_GEMMA_BASE_URL` routes nothing — this is the one that moves bytes |
| `GEMMA_ONTOLOGY_URL` | `GEMMA_BASE_URL` | serves `/rest/v2/annotations/*` + `/genes`. Unset disables ontology term search |
| `GEMMA_BROWSER_BACKEND` | `http://host.docker.internal:8080` | upstream the browser UI proxies `/rest` to. Default reaches local Gemma 2.0 on the host. Flip to `http://gemma-rest:8080` when running `--gemma`, or to staging / prod URLs. |
| `GEMMA_AGENTS_USE_ZOTERO` | unset | `1` to enable Zotero biolit fetcher |

## Linux self-contained setup

To make this run on a fresh Linux box without the host bind-mounts:

1. Clone both repos (`gemma-curation-ui`, `gemma-curation-agents`) side-by-side.
2. Drop the Gemma WAR somewhere; set `GEMMA_WAR_PATH`.
3. Drop a MySQL seed `.sql.gz` under `GEMMA_DB_SEED_DIR`. The agents-side
   service can publish a periodic dump — until then the DB starts empty and
   you load via `gca mock-gemma import …` after first boot.
4. Set `ANTHROPIC_API_KEY` as an env var (no keychain on Linux). Set
   `GEMMA_USERNAME` / `GEMMA_PASSWORD` too unless you are using
   `--gemma`, whose seeded `groupadmin` is the default.
5. `./up.sh --gemma`.

## Talking to the running stack

```sh
docker compose logs -f curation-ui      # vite output (apps/curation)
docker compose logs -f browser-ui       # vite output (apps/browser)
docker compose logs -f local-api        # FastAPI for /rest/v2/*
docker compose logs -f proposer         # FastAPI for /propose, /audit, /find-*
docker compose exec local-api gca mock-gemma reset-curation
docker compose exec local-api gca mock-gemma import --help
```

## Coexistence with `~/launch-local-mode.sh`

That script and this compose target the **same Vite + Python
services**. Run one or the other, not both. If you had the script's
processes alive, `./up.sh` will conflict on port `:5175` /
`:8082` / `:8095`. Stop them first:

```sh
for r in local-api curation-ui; do
    [ -f /tmp/local-mode-$r.pid ] && kill $(cat /tmp/local-mode-$r.pid)
done
```

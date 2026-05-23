# local-mode docker stack

One-command containerized "local mode" for the curation flow.

## What it runs

| service | image | host port | role |
|---|---|---|---|
| `local-api` | `gemma-local-mode/agents:dev` (built from `Dockerfile.agents`) | `:8095` | Curation backend (FastAPI, `gca mock-gemma serve`). Hosts the SQLite that calibration packages load into. |
| `proposer` | same image, different command | `:8082` | Long-running FastAPI for `/propose`, `/audit`, `/find-*`. |
| `curation-ui` | `gemma-local-mode/curation-ui:dev` (built from `Dockerfile.curation-ui`) | `:5175` | Vite dev server for `apps/curation/`. Talks to the two services over the compose network. |
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

Then visit **http://localhost:5175/**.

`up.sh` resolves `ANTHROPIC_API_KEY`, `GEMMA_CURATION_API_KEY`, and
optional Zotero creds from the macOS Keychain (same pattern as
`run_local.sh` / `run_proposer_service.sh`). Pre-set env vars
override the keychain lookup.

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
| `GEMMA_WAR_PATH` | `~/Dev/eclipseworkspace/Gemma/gemma-rest/target/gemma-rest.war` | only with `--gemma`; the WAR file Tomcat hosts |
| `GEMMA_DB_NAME` / `GEMMA_DB_USER` / `GEMMA_DB_PASSWORD` / `GEMMA_DB_ROOT_PASSWORD` | `gemd` / `gemmaadmin` / `gemmatoast` / `gemmatoast` | MySQL creds — match what the WAR expects |
| `GEMMA_DB_SEED_DIR` | `./seed-empty` (empty) | drop `.sql.gz` files here for first-boot DB import |
| `GEMMA_BASE_URL` | `https://staging-gemma.msl.ubc.ca` | read-side Gemma for the proposer. Set to `http://gemma-rest:8080` when running `--gemma` |
| `GEMMA_AGENTS_USE_ZOTERO` | unset | `1` to enable Zotero biolit fetcher |

## Linux self-contained setup

To make this run on a fresh Linux box without the host bind-mounts:

1. Clone both repos (`gemma-curation-ui`, `gemma-curation-agents`) side-by-side.
2. Drop the Gemma WAR somewhere; set `GEMMA_WAR_PATH`.
3. Drop a MySQL seed `.sql.gz` under `GEMMA_DB_SEED_DIR`. Bro can
   publish a periodic dump — until then the DB starts empty and you
   load via `gca mock-gemma import …` after first boot.
4. Set `ANTHROPIC_API_KEY` as an env var (no keychain on Linux).
5. `./up.sh --gemma`.

## Talking to the running stack

```sh
docker compose logs -f curation-ui      # vite output
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

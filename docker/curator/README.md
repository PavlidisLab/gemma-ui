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

## Curator setup (the deliverable)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop) (mac/win) or Docker Engine (linux).
2. Get this `curator/` folder (zip / git clone).
3. `cp .env.example .env` — edit `GEMMA_BASE_URL` to point at the off-site Gemma 2.0.
4. `docker compose pull` (or `docker compose up --build` if a registry isn't set up yet).
5. `docker compose up -d`.
6. Open <http://localhost:5175/>.

To load a calibration package:

```sh
# Drop the package directory into ./calibration-packages/ on the host
docker compose exec local-api gca mock-gemma import /calibration-packages/<package-dir>
```

Or wipe + reload:

```sh
docker compose exec local-api gca mock-gemma reset-curation
docker compose exec local-api gca mock-gemma import /calibration-packages/<package-dir>
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

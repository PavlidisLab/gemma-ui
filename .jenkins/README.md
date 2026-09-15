# Jenkins

`Jenkinsfile` is the CI/CD pipeline for **apps/browser**: it checks the
repo, then publishes the static build with `scripts/deploy-browser.sh`.
`apps/curation` is not built or deployed here.

Run this before pushing any change to this directory — it is a
server-side syntax check, and without it a declarative-syntax error is
first reported by the build that fails on it:

```bash
.jenkins/validate-jenkinsfile
```

It needs a Jenkins API token: `jenkins.pavlab` has no anonymous read, so
an unauthenticated call gets a 403 HTML page where it expects a crumb.
Store the token once and it is picked up automatically:

```bash
secret-tool store --label='Jenkins API token' \
    service jenkins.pavlab.msl.ubc.ca username "$USER"
```

(Token from <https://jenkins.pavlab.msl.ubc.ca/user/$USER/configure> →
"API Token"; a password is rejected.) `JENKINS_USER` / `JENKINS_API_TOKEN`
in the environment win over the store.

## What deploys where

| branch          | targets                      | URL |
| --------------- | ---------------------------- | --- |
| `main`          | `production`                 | <https://gemma.msl.ubc.ca/> |
| `development`   | `staging`, `gemma2testing`   | <https://staging-gemma.msl.ubc.ca/>, <https://gemma2.msl.ubc.ca/> |
| everything else | none — checks only           | |

`master` is accepted as a synonym for `main` so the map survives a
default-branch rename; the repo has no `master` branch today.

A target is entirely defined by `apps/browser/.env.<target>` (the Vite
mode, `VITE_BASE_PATH`, `DEPLOY_DEST`). The pipeline passes a bare
target name and reads nothing else — adding a deployment is a new env
file plus one line in `targetsForBranch()`.

## One-time setup in Jenkins

1. **Node on the agent.** There is no `node` on the agent's `PATH` and
   none under `/space/opt` (checked 2026-09-15), so the first build
   fails in the `Toolchain` stage with the commands to fix it:

   ```bash
   cd /space/opt
   curl -fsSLO https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz
   tar -xJf node-v22.20.0-linux-x64.tar.xz
   chmod -R g+rX node-v22.20.0-linux-x64
   ```

   `/space/opt` is shared NFS every agent reads, which is why it goes
   there. The alternative is the Jenkins **NodeJS plugin** — see
   the comment on `NODE_HOME` in the `Jenkinsfile` for the swap.

2. **Docroot permissions.** The deploy writes to `/space/web/gemma-ui/<target>`
   as the Jenkins user. As of 2026-09-15 only `production` is
   group-writable; `staging` and `gemma2testing` are `drwxr-xr-x`, so a
   deploy of either fails on permissions. Jenkins must be in the
   `pavlab` group and:

   ```bash
   chmod -R g+w /space/web/gemma-ui/staging /space/web/gemma-ui/gemma2testing
   ```

   (The deploy itself publishes with `--chmod=D775,F664`, so the tree
   stays group-writable afterwards.)

3. **The job.** A **multibranch pipeline** named e.g. `gemma-ui`, branch
   source GitHub → `PavlidisLab/gemma-ui`, script path
   `.jenkins/Jenkinsfile`. That is what makes a push to `main` and a push
   to `development` run different work from one definition.

4. **The webhook.** Add `https://jenkins.pavlab.msl.ubc.ca/github-webhook/`
   as a push webhook on the GitHub repo (or let the GitHub Branch Source
   plugin manage it), so commits trigger builds. Without it the job only
   runs when scanned or started by hand; `triggers { pollSCM('H/5 * * * *') }`
   is the fallback if webhooks cannot be used.

## Build parameters

- `NODE_HOME` — the Node installation to build with (must be >= 20.12).
- `FORCE_DEPLOY_TARGET` — deploy one named target regardless of branch.
  For manual re-deploys and for deploying from a branch that maps to
  nothing. `(none)` means "use the branch map", which is every
  webhook-triggered build.
- `DRY_RUN` — build and run `rsync --dry-run`: report what would change,
  publish nothing. Use it to exercise the job without touching a docroot.

## Notes

- **`npm run lint` is not a gate.** It reports 7 errors and 123 warnings
  against the tree as of 2026-09-15; gating on it would fail every build
  from the first one. Add it to the `Check` stage once that is zero.
- Concurrent builds are disabled, and each target deploy takes a
  `lock('gemma-ui-browser-<target>')`. `deploy-browser.sh` publishes with
  `rsync --delete`, so two deploys into one docroot would race over which
  build's assets survive and could leave a half-built site being served.

# sqlwb-web — runbook

**Status: not tested from scratch.** Build, smoke tests and Playwright ran on a Windows laptop (2026-11-06). `scripts/deploy.sh` is a generic version of a script that ran on a real server; the generic version did not run yet.

## 1. Purpose

Run SQL Workbench/J as a web app for a team, in one container with a CPU and memory limit.

## 2. Prerequisites

| Item | Check |
|---|---|
| Build machine: Docker with BuildKit | `docker buildx version` exits 0 |
| Build machine: Node 22+ (only for the tests) | `node -v` |
| Server: Docker 18.03+ | `docker version --format '{{.Server.Version}}'` |
| Server: free port (default 8484) | `ss -ltn \| grep -c ':8484 '` prints `0` |
| Network (build): codeberg.org, Maven Central, npmjs | `git ls-remote https://codeberg.org/sql-workbench/workbench.git refs/tags/build133` prints one line |
| Network (server, only for the Update button): sql-workbench.eu | `curl -sI https://www.sql-workbench.eu/downloads.html` returns `200` |

## 3. Site config

Keep your site values out of this repo (`.gitignore` skips `*.env` and `docker-compose.override.yml`).

```bash
cp config.example/sqlwb.env.example mysite.env      # edit: image, default URL, admins, limits, DNS search
cp config.example/docker-compose.override.example.yml docker-compose.override.yml   # optional, compose only
```

## 4. Get the image

| Way | Steps |
|---|---|
| From GitHub (GHCR) | Push a tag: `git tag v0.1.0 && git push origin v0.1.0`. The workflow pushes `ghcr.io/<owner>/sqlwb-web:0.1.0` and `:latest`. Make the package public in GitHub (Packages → Settings), or run `docker login ghcr.io` on the server |
| Local build | `docker compose build` → image `sqlwb-web:local` |
| No registry on the server | `docker save <image> -o sqlwb-web.tar`, copy the tar to the server, pass it to `deploy.sh` |

## 5. Test on the build machine

```bash
docker compose build
docker compose up -d
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8484/api/health   # expect 200
docker compose down
```

Smoke tests need H2. Start a test container with H2 allowed (never on a shared server):

```bash
docker run -d --rm --name sqlwb-test -p 18484:8484 -e JDBC_URL_ALLOW='jdbc:(h2|oracle|postgresql):.*' sqlwb-web:local
node scripts/smoke-ws.mjs http://localhost:18484   # expect "PASS smoke-ws", exit 0
node scripts/smoke-wb.mjs http://localhost:18484   # expect "PASS smoke-wb", exit 0
docker stop sqlwb-test
cd frontend && npx playwright test                 # mock mode, expect exit 0
```

## 6. Deploy on the server

Copy `scripts/deploy.sh` and your env file to the server. Then:

```bash
sh deploy.sh mysite.env                 # pulls SQLWB_IMAGE
sh deploy.sh mysite.env sqlwb-web.tar   # or loads the image from a tar
```

The script keeps the running image as `<name>:prev`, replaces the container, waits for `/api/health`, and starts the old container again on failure.

Check (pass = exit code 0 and the line `PASS health 200`):

```bash
curl -fsS http://localhost:8484/api/health
```

Open `http://<server>:8484`. With `SIGNUP=true` the first login with a new name creates the app user.

## 7. Benchmark (results go into `docs/benchmarks.md`)

```bash
read -r -p 'DB user: ' DB_USER; read -r -s -p 'DB password: ' DB_PASSWORD; echo
export DB_USER DB_PASSWORD
docker run --rm --network host -e USERS=20 -e DB_USER -e DB_PASSWORD \
  -e DB_URL='jdbc:oracle:thin:@//db.example.com:1521/SERVICE' \
  -v "$PWD/scripts:/s:ro" node:24-alpine node /s/bench.mjs
```

During the run: `docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' sqlwb-web`. Pass = exit code 0.

## 8. Update

| Kind | Steps |
|---|---|
| New SQL Workbench build, fast way | Log in as an admin (`ADMIN_USERS`) → toolbar "Update to Build N" → confirm. The app downloads the official zip, checks SHA-1, installs to `/data/wb/current` and restarts. Check: `curl -s localhost:8484/api/version` |
| New SQL Workbench build, from source | Set `WB_BUILD` in `docker-compose.yml` and `ARG WB_BUILD` in `Dockerfile`. Build and deploy (§4-6). Then remove an older engine from the Update button: `docker exec sqlwb-web rm -rf /data/wb/current && docker restart sqlwb-web` |
| New app version | New tag → new image → `sh deploy.sh mysite.env`. The volume keeps users, workspaces and profiles |

## 9. Rollback

| Kind | Steps | Check |
|---|---|---|
| Engine update | `docker exec sqlwb-web rm -rf /data/wb/current && docker restart sqlwb-web` | `/api/version` shows the build of the image |
| App version | `sh deploy.sh mysite.env --rollback` (starts `<name>:prev`, the image before the last deploy) | Exit code 0, `/api/health` returns `200` |
| Remove everything | `docker rm -f sqlwb-web && docker volume rm sqlwb-data` | `docker ps -a \| grep -c sqlwb-web` prints `0` |

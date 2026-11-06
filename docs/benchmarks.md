# Benchmarks

Script: `scripts/bench.mjs` (steps in [RUNBOOK.md](../RUNBOOK.md) §6). Targets come from the project goal.

| Check | Target |
|---|---|
| 1,000 statements in one script: app overhead = (server wall time − DB execute/fetch time) / server wall time | < 5% |
| 100k rows x 20 columns: first 500 rows at the client | < 1 s |
| 10 users in parallel: p95 round trip of a short select | < 200 ms |
| App CPU during the tests (`docker stats`) | ≤ 200% (2 vCPU) |

## 2026-11-05 — laptop, H2 in memory (not the target setup)

Setup: Windows 11 laptop, Docker Desktop, backend container `--cpus 2`, Java 21 ZGC, H2 2.3.232 in memory, SQL Workbench/J Build 132.

| Check | Result | Pass |
|---|---|---|
| 1,000 statements, app overhead | 28.9% (server 38 ms, DB 27 ms) | no (see note) |
| 100k x 20, first 500 rows | 398 ms | yes |
| 10 users, p95 | 27.0 ms (7,917 queries in 20 s) | yes |
| App CPU after the run | 1% | — |

Note: H2 in memory needs ~27 µs per statement, so the app overhead of ~11 µs per statement looks large. Against Oracle (one network round trip, ~0.3-1 ms) the same overhead is ~1-4%. The real result needs a real Oracle server.

## 2026-11-05 — fetch on scroll, laptop, H2 in memory (not the target setup)

Setup: Windows 11 laptop, Docker Desktop, container `--cpus 2 -m 3g`, H2 in memory, `select` of 1,000,000 rows x 20 columns (`system_range`). Script: a WebSocket client like `scripts/bench.mjs` (not in the repo). Old = image `ae858dc5402e` + old client (asks for each next page at once). New = image `7cca3bec23d0` + new client (first page, 5 s idle, then "Fetch all").

| Check | Old | New |
|---|---|---|
| First 500 rows at the client | 27,797 ms | 19,223 ms |
| Rows sent while the user does not scroll (5 s) | all 1,000,000 | 500 |
| All rows ("Fetch all") | 104,109 ms | 54,718 ms |
| JSON over the WebSocket for all rows | 195 MB | 195 MB |
| Max. container RAM (`docker stats`, 1 s samples) | 1.58 GiB | 1.72 GiB |

Notes:
- First page: H2 builds the full 1M-row result before the first row, so ~20-28 s is H2 time, not app time. Oracle streams rows; a run against Oracle (RUNBOOK §6) gives the real number.
- RAM: H2 keeps its result in the same JVM, and the JVM does not give heap back at once. So this test does not show the server saving (sent rows are no longer kept). Measure on a server with Oracle.
- All rows: one run each; the difference can be laptop noise.

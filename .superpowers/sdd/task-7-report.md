# Task 7 Report: AirPlay backend via UxPlay

## Done

- `createAirplayBackend` + `mapAirplayStderr` in `electron/session/backends/airplay-backend.ts`
- Spawns `uxplay -n <name> -nh`; `viewerUrl: null`; 1s settle; process-tree kill on stop
- `AIRPLAY_BINARY_MISSING` + `AIRPLAY_PORT_IN_USE` error mapping
- `vendor/README.md`: Windows UxPlay/GStreamer install, `MYCAST_UXPLAY`, firewall notes
- `main.ts`: real AirPlay when `MYCAST_USE_MOCK !== '1'`
- README AirPlay section

## Tests

`npm test` — **33 passed** (7 new in `airplay-backend.test.ts`, 1 in `errors.test.ts`)

## Manual

Not run (no UxPlay binary in repo). Place `vendor/uxplay/uxplay.exe` or set `MYCAST_UXPLAY`, then mirror from iPhone Control Center.

## Commit

`feat: add AirPlay backend wrapping UxPlay`

## Fix (P1/P2)

- `start()` try/catch: on `waitForStartup` failure, `cleanupFailedStart` kills process tree, clears `this.child`
- `stdio: ['ignore', 'ignore', 'pipe']`; permanent stderr drain after successful start
- Tests: killTree/kill on port-in-use failure; retry spawn after cleanup; stdio assertion

`npm test` — **34 passed**

Commit: `fix: cleanup AirPlay process on start failure and drain pipes`

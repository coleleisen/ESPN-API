# ESPN fantasy scraper API

Run with Node 22.12 or later. Copy `.env.example` to `.env`, configure the database credentials, run `npm install`, then `npm start`. The default port is 3001. Puppeteer uses an installed Chrome/Edge on Windows or its downloaded Chrome elsewhere; `PUPPETEER_EXECUTABLE_PATH` overrides the executable.

## Login and recurring scrapes

Request examples are in [examples/scrape.http](examples/scrape.http).

1. Send `POST /scrape` with `username`, `password`, `league` and `sport` (`hockey` or `basketball`). Include the numeric `leagueId` if the league name cannot be uniquely discovered.
2. If ESPN asks for a verification code, the API returns HTTP 409 with `status: verification_required` and a `challengeId`. Submit the code and challenge ID to `POST /scrape/verify` within 15 minutes. The same API process must handle both requests.
3. After a verified login, save the returned `sessionToken` in your scheduler's secret configuration. Subsequent `POST /scrape` requests use `sessionToken`, `league` and `sport`, without the password or verification code.

The token refers to a saved browser profile on this server. Keep `ESPN_SESSION_DIR` on persistent private storage (the default is the ignored `.espn-sessions` directory). Ephemeral deployment storage loses sessions on restart/redeploy. Run one scrape at a time per token. The profile and token both grant access to the account and must remain private.

For the local IFHL session saved during setup, run `powershell -NoProfile -File .\examples\scrape-ifhl.ps1` while the API is running. This reads the token from the ignored `.espn-sessions/ifhl-run.json` file and prints only a result summary. The same command can be used by Windows Task Scheduler; no recurring schedule is installed automatically.

Session reuse does not bypass two-factor authentication. ESPN may expire or revoke the login; HTTP 401 with `ESPN_REAUTH_REQUIRED` means automation must wait for another interactive verified login. A transient network failure retains the session. If login succeeds but league collection fails, the error response can still contain a reusable `sessionToken`.

`POST /fetch` with `{ "league": "IFHL" }` reads the most recently saved league. Failed or incomplete scrapes preserve the previous database record. Login challenges and session tokens are never included in league documents.

The scraper reads the current rosters and the selected statistics period (`currSeason` by default). Team totals include bench players and exclude IR slots; they are roster comparisons, not official matchup standings. Hockey includes both skaters and goalies, and points leagues expose `FPTS` plus `scoringType: points`. All players and teams use the same category order, including zero totals. Basketball shooting percentages use made/attempted weights. Hockey leagues using `GAA` or `SV%` currently return `UNSUPPORTED_RATE_STATISTICS` because the HTML may omit the weights needed to aggregate those rates correctly.

## Validation

Run `npm test`. Tests cover browser-based login/verification, cookie and local-storage persistence across browser restarts, session expiry/concurrency, API error handling, and schema/atomic-update behavior. They use fixtures and do not prove that a live ESPN league scrape succeeded.

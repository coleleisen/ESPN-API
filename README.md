# ESPN fantasy scraper API

Run with Node 24.12.0, the version pinned in `package.json`. Copy `.env.example` to `.env`, configure the database credentials, run `npm ci`, then `npm start`. The default port is 3001. Puppeteer uses an installed Chrome/Edge on Windows or its downloaded Chrome elsewhere; `PUPPETEER_EXECUTABLE_PATH` overrides the executable.

## Production runtime

Render reads `engines.node` from `package.json`. Keep this pinned while the API uses Mongoose 5 and MongoDB driver 3: their connection parser uses legacy URL behavior that throws on Node 25 and later ([Node DEP0170](https://nodejs.org/api/deprecations.html#dep0170-invalid-port-when-using-urlparse)). An unbounded range such as `>=22.12.0` can select an incompatible Node release and leave `/fetch` returning HTTP 500 even though the HTTP server starts.

Use `npm ci` as the Render build command to install the versions in `package-lock.json`, and `npm start` as the start command. Set `DB_USER` and `DB_PASS` in the service's environment. A `NODE_VERSION` environment variable overrides the package setting; if present, keep it at `24.12.0` too. After deployment, confirm `connected to db` appears in the logs and `POST /fetch` with `{ "league": "DGFBL" }` returns HTTP 200.

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

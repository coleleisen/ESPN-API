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

## Scraper Agent

The companion `ESPN-Fantasy` frontend includes a **Scraper Agent** section at `#/scraper-agent`. It supports prompts and follow-up questions, a selected team, optional web research with clickable citations, and a refresh button for ESPN data. It gives recommendations; it does not submit trades, claims, drops, or lineup changes.

Configure these values in this API project's ignored `.env`, or in the API host's environment, then restart the API:

```dotenv
OPENAI_API_KEY=your-openai-api-key
OPENAI_ADVISOR_MODEL=gpt-6.1-sol
ESPN_ADVISOR_SESSION_FILE=C:/Projects/ESPN-API/.espn-sessions/ifhl-run.json
```

Visitors can open the advisor and chat automatically using the app's server-side OpenAI key. No user API key, access code, or authorization header is needed. The OpenAI key stays on the API server; do not put it in `REACT_APP_*`, browser storage, or Git. The frontend keeps the conversation in memory for the current visit. Chat and refresh requests share limits of 20 requests per minute and two concurrent operations per API process. These limits are per process, not shared across multiple API instances.

The chat-specific `OPENAI_ADVISOR_MODEL` setting defaults to `gpt-6.1-sol`. Legacy `OPENAI_MODEL` is deliberately no longer read by Scraper Agent: existing installations using the old Astra setting receive the lower-cost default on deployment without requiring a Render environment change. To explicitly override it, set `OPENAI_ADVISOR_MODEL` to a Responses model that supports function calling and web search. GPT-6 models use low reasoning effort and standard service tier. There is no automatic fallback to a more expensive model.

`ESPN_ADVISOR_SESSION_FILE` points to the private JSON file containing a verified `sessionToken`, using the existing persistent browser profile on the same server. It is optional for chatting with saved data, and required for **Refresh league data**. The initial full-pool refresh supports basketball. Hockey can use saved roster analysis, with missing waiver data explicitly identified. Renew an expired ESPN login using the existing `/scrape` verification flow.

The advisor refresh saves a separate `AdvisorSnapshot` document, leaving the dashboard's selected stats view intact. For basketball it reads every team and the complete paginated player pool, including roster ownership, lineup slots, injury designations, eligibility, waiver/free-agent status, scoring rules, acquisition/trade rules, current actual stats, projections, previous-season stats, and ESPN's rolling 7/15/30-day splits. Totals and per-game averages remain separate. Unavailable statistics stay empty; preseason absence is not zero performance. Unknown ESPN statistic identifiers retain explicit labels instead of guessed meanings. Refresh failures preserve the previous complete dataset.

Every chat request reloads the database. Its compact prompt contains the complete roster ownership map, selected-team scoring averages/projections, league rules, and team category comparisons. Comparisons sum available per-game stats assuming equal games per player, include bench and exclude IR, weight shooting percentages by attempts, and report coverage; they are not weekly forecasts. Missing stats remain null. A scoped, read-only tool retrieves any player's other statistical periods from the full pool, ranked by a selected statistic and paginated. Default tool results include scoring categories and shooting weights; `detail: all` retrieves all saved stats and totals for the requested period. Pages contain at most 20 players and shrink when needed to control size, with `nextOffset` preserving access to every candidate. Freshness warnings and the current clock follow the stable league payload to improve cache reuse. The advisor flags data older than six hours and any newer dashboard scrape; refreshing is manual, not scheduled. ESPN data is a snapshot, not a guarantee that a player is still available when a claim is submitted.

The integration uses the [OpenAI Responses API's web search](https://developers.openai.com/api/docs/guides/tools-web-search) and [function calling](https://developers.openai.com/api/docs/guides/function-calling). Web research is opt-in, off by default in both the API and frontend. Once enabled, the model decides whether a search is needed. Answers report whether it searched and carry citation URLs/offsets. Requests set `store: false`; recent chat history is sent explicitly on each turn. OpenAI receives league data and questions to generate answers. The model and search consume your OpenAI API account's usage; model access and billing must be enabled. No automatic retries are made after upstream failures.

Answers include input, cached-input, output/reasoning tokens, model-call and web-search counts, and an estimated USD cost displayed in the frontend. The estimate uses published standard rates dated 2026-10-14, treats all uncached input at the higher cache-write rate, and includes web-search call fees. Reasoning is already part of output tokens and is not double-counted. Estimates are not billing statements; unknown models return no dollar estimate. Completed usage is also returned on failures, with missing/interrupted usage marked incomplete. Rates are maintained in `advisor/usage.js`.

Endpoints (examples in `examples/chat.http`):

- `GET /chat/status?league=DGFBL`: readiness, team choices and dataset freshness; no secrets.
- `POST /chat`: `{ league, teamId?, message, research?, history? }`. Uses the server's configured OpenAI key and returns `answer`, `citations`, `webSearchUsed`, `usage`, and dataset metadata.
- `POST /chat/refresh`: `{ league }`. Refreshes the complete basketball dataset using the configured ESPN session.

Questions are limited to 4,000 characters. The API still accepts the older history envelope (20 messages, 12,000 characters each, 60,000 total) for compatibility, but both server and frontend independently retain at most 12 recent messages, 4,000 characters each and 12,000 total for model input. Each answer is bounded to three model calls, four player lookups, two web searches, 4,000 total output tokens (at most 1,800 per call), a 60 KB serialized prompt guard, and a three-minute timeout. The last call must answer without further tools. These are per-answer resource limits, not a monthly dollar cap. Provider failures, limits, missing configuration, invalid teams and incomplete results return explicit errors with any known usage.

Validation uses mocked OpenAI responses for tool routing, history, citations, automatic use of the server key, rate limits and failures, plus the existing scraper tests. A real OpenAI answer requires a configured key. The frontend test suite and production build are in the neighboring `ESPN-Fantasy` project.

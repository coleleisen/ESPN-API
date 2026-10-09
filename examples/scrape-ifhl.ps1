param(
    [string]$SessionFile = (Join-Path $PSScriptRoot '../.espn-sessions/ifhl-run.json'),
    [string]$Api
)

$ErrorActionPreference = 'Stop'
$savedSession = Get-Content -LiteralPath $SessionFile -Raw | ConvertFrom-Json
if (-not $savedSession.sessionToken) {
    throw 'No verified ESPN session is saved. Complete the initial login first.'
}
if (-not $Api) { $Api = $savedSession.api }
if (-not $Api) { $Api = 'http://localhost:3001' }

$payload = @{
    sessionToken = $savedSession.sessionToken
    league = 'IFHL'
    sport = 'hockey'
    leagueId = '94490680'
} | ConvertTo-Json

# Only print the scrape summary, never the session token.
Invoke-RestMethod -Method Post -Uri ($Api.TrimEnd('/') + '/scrape') `
    -ContentType 'application/json' -Body $payload -TimeoutSec 1200 |
    Select-Object status, league, teams, lastUpdate

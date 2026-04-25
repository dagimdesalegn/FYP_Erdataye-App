# Enables GitHub branch protection on `main` (PR + CI + no force-push).
# Requires repo admin: set GITHUB_TOKEN or GH_TOKEN to a classic PAT with `repo` scope,
# or a fine-grained token with Administration: read-write and Contents: read.
#
# Usage (PowerShell, from repo root):
#   $env:GITHUB_TOKEN = "ghp_..." ; ./scripts/enable-main-branch-protection.ps1
#
# To use a different payload, set MAIN_PROTECTION_JSON to a file path.

$ErrorActionPreference = "Stop"
$token = $env:GITHUB_TOKEN ?? $env:GH_TOKEN
if (-not $token) {
    Write-Error "Set GITHUB_TOKEN or GH_TOKEN to a token with admin rights on dagimdesalegn/FYP_Erdataye-App."
}

$owner = "dagimdesalegn"
$repo = "FYP_Erdataye-App"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bodyPath = if ($env:MAIN_PROTECTION_JSON) { $env:MAIN_PROTECTION_JSON } else { Join-Path $scriptDir "main-branch-protection.json" }
if (-not (Test-Path -LiteralPath $bodyPath)) {
    Write-Error "Missing protection JSON: $bodyPath"
}
$body = Get-Content -LiteralPath $bodyPath -Raw -Encoding utf8

$uri = "https://api.github.com/repos/$owner/$repo/branches/main/protection"
$headers = @{
    Authorization          = "Bearer $token"
    Accept                 = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

try {
    $result = Invoke-RestMethod -Uri $uri -Method Put -Headers $headers -Body $body -ContentType "application/json; charset=utf-8"
    Write-Host "Branch protection enabled on main."
    Write-Host ($result | ConvertTo-Json -Depth 6)
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $reader = [System.IO.StreamReader]::new($resp.GetResponseStream())
        $detail = $reader.ReadToEnd()
        $reader.Dispose()
        Write-Host "Response body: $detail"
    }
    $code = $resp.StatusCode.value__
    Write-Error "GitHub API failed (HTTP $code). If checks are unknown, edit scripts/main-branch-protection.json and set contexts to [] then retry."
}

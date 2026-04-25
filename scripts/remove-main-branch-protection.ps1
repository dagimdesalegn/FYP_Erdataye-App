# Removes GitHub branch protection on `main` (requires repo admin + token).
# To (re)enable protection, use: ./scripts/enable-main-branch-protection.ps1
# Usage (PowerShell):  $env:GITHUB_TOKEN = "ghp_..." ; ./scripts/remove-main-branch-protection.ps1
# Create token: GitHub -> Settings -> Developer settings -> PAT, scope: repo (full control for private repos).

$ErrorActionPreference = "Stop"
$token = $env:GITHUB_TOKEN ?? $env:GH_TOKEN
if (-not $token) {
    Write-Error "Set GITHUB_TOKEN or GH_TOKEN to a PAT with admin access to the repository."
}
$owner = "dagimdesalegn"
$repo = "FYP_Erdataye-App"
$uri = "https://api.github.com/repos/$owner/$repo/branches/main/protection"
$headers = @{
    Authorization  = "Bearer $token"
    Accept         = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}
try {
    Invoke-RestMethod -Uri $uri -Method Delete -Headers $headers
    Write-Host "Branch protection removed on main."
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Error "GitHub API failed (HTTP $code). Ensure the token is a repo admin and has repo scope."
}

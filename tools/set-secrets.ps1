param(
  [string]$Repo = ''
)

$ErrorActionPreference = 'Stop'

function Ensure-GH {
  $gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
  if(-not $gh){
    $cand = Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe'
    if(Test-Path $cand){ $gh = $cand }
  }
  if(-not $gh){
    Write-Host 'GitHub CLI not found. Attempting install via winget/choco/scoop...'
    $installed=$false
    if(Get-Command winget -ErrorAction SilentlyContinue){ try { winget install --id GitHub.cli -e --source winget --accept-package-agreements --accept-source-agreements; $installed=$true } catch { Write-Host "winget install failed: $_" } }
    if(-not $installed -and (Get-Command choco -ErrorAction SilentlyContinue)){ try { choco install gh -y; $installed=$true } catch { Write-Host "choco install failed: $_" } }
    if(-not $installed -and -not (Get-Command scoop -ErrorAction SilentlyContinue)){
      try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; iwr -useb get.scoop.sh | iex } catch { Write-Host "scoop bootstrap failed: $_" }
    }
    if(-not $installed -and (Get-Command scoop -ErrorAction SilentlyContinue)){ try { scoop install gh; $installed=$true } catch { Write-Host "scoop install failed: $_" } }
    if(-not $installed){ throw 'Failed to install GitHub CLI. Install manually: https://cli.github.com' }
    $gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
    if(-not $gh){ $gh = (Join-Path $env:ProgramFiles 'GitHub CLI\gh.exe') }
  }
  return $gh
}

function Resolve-RepoSlug {
  param([string]$Fallback)
  if($Fallback){ return $Fallback }
  $origin = git remote get-url origin
  if($origin -match 'github.com[:/](?<owner>[^/]+)/(?<repo>[^\.]+)'){
    return "$($Matches.owner)/$($Matches.repo)"
  }
  throw 'Unable to resolve repo slug; pass -Repo <owner/repo>'
}

$gh = Ensure-GH
$slug = Resolve-RepoSlug -Fallback $Repo

Write-Host "Using repo: $slug"
try { & $gh auth status --hostname github.com | Out-Null } catch { throw 'gh not authenticated. Run: gh auth login' }

# Secret
& $gh secret set FIREBASE_TOKEN -R $slug --body "${env:FIREBASE_TOKEN}"

# Variables
& $gh variable set FIREBASE_API_KEY -R $slug --body "${env:FIREBASE_API_KEY}"
& $gh variable set FIREBASE_AUTH_DOMAIN -R $slug --body "${env:FIREBASE_AUTH_DOMAIN}"
& $gh variable set FIREBASE_PROJECT_ID -R $slug --body "${env:FIREBASE_PROJECT_ID}"
& $gh variable set FIREBASE_STORAGE_BUCKET -R $slug --body "${env:FIREBASE_STORAGE_BUCKET}"
& $gh variable set FIREBASE_MESSAGING_SENDER_ID -R $slug --body "${env:FIREBASE_MESSAGING_SENDER_ID}"
& $gh variable set FIREBASE_APP_ID -R $slug --body "${env:FIREBASE_APP_ID}"
& $gh variable set FIREBASE_MEASUREMENT_ID -R $slug --body "${env:FIREBASE_MEASUREMENT_ID}"

Write-Host 'Configured repo secret and variables.'

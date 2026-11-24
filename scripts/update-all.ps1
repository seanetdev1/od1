param(
  [switch] $AllowDirtySkip,
  [switch] $CheckOnly
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$git = (Get-Command git.exe -ErrorAction Stop).Source

$upstreams = @(
  @{
    Name   = 'Frontend'
    Remote = 'upstream-frontend'
    Url    = 'https://github.com/Bilal-Seanet/odyssey-front-end.git'
    Branch = 'main'
    Prefix = 'odyssey-front-end'
  },
  @{
    Name   = 'Backend'
    Remote = 'upstream-backend'
    Url    = 'https://github.com/Bilal-Seanet/odyssey-backend-server.git'
    Branch = 'main'
    Prefix = 'odyssey-backend-server'
  }
)

function Invoke-Git {
  param(
    [string[]] $ArgsList,
    [switch] $AllowFailure
  )
  Push-Location -LiteralPath $root
  try {
    $out = & $git @ArgsList 2>&1
    $code = $LASTEXITCODE
    if (-not $AllowFailure -and $code -ne 0) {
      throw "git $($ArgsList -join ' ') failed (exit $code):`n$($out -join "`n")"
    }
    return [PSCustomObject]@{ ExitCode = $code; Output = ($out -join "`n") }
  }
  finally {
    Pop-Location
  }
}

Write-Host '========================================================================'
Write-Host ' Odyssey — Safe Upstream Synchronization'
Write-Host '========================================================================'

# 1. Verify we are inside a Git repository with at least one commit
$revCheck = Invoke-Git -ArgsList @('rev-parse', '--verify', 'HEAD') -AllowFailure
if ($revCheck.ExitCode -ne 0) {
  throw "Repository at $root has no commits yet. Complete monorepo initialization before running update-all."
}

# 2. Check working tree cleanliness (NEVER discard uncommitted local changes)
$statusOut = (Invoke-Git -ArgsList @('status', '--porcelain')).Output.Trim()
if (-not [string]::IsNullOrWhiteSpace($statusOut)) {
  if ($AllowDirtySkip) {
    Write-Warning 'Uncommitted local changes detected. Skipping upstream pull to protect your work.'
    Write-Host 'Commit or stash your changes and run update-all.bat to pull upstream updates.'
    exit 0
  }
  throw "Working tree has uncommitted changes. Commit or stash your local work before running update-all.bat (this script never discards local edits)."
}

# 3. Ensure read-only upstream remotes exist (push explicitly disabled)
$existingRemotes = @((Invoke-Git -ArgsList @('remote')).Output -split '\r?\n' | Where-Object { $_ })
foreach ($u in $upstreams) {
  if ($existingRemotes -notcontains $u.Remote) {
    Write-Host "Adding upstream remote '$($u.Remote)' -> $($u.Url)"
    Invoke-Git -ArgsList @('remote', 'add', $u.Remote, $u.Url) | Out-Null
  }
  else {
    $currentUrl = (Invoke-Git -ArgsList @('remote', 'get-url', $u.Remote)).Output.Trim()
    if ($currentUrl -ne $u.Url) {
      Invoke-Git -ArgsList @('remote', 'set-url', $u.Remote, $u.Url) | Out-Null
    }
  }
  # Hard safety guard: never allow pushing to original upstream repositories
  Invoke-Git -ArgsList @('remote', 'set-url', '--push', $u.Remote, 'DISABLED') | Out-Null
}

$updatedPrefixes = @()
$lockfilesChanged = @()

foreach ($u in $upstreams) {
  Write-Host "`n[$($u.Name)] Fetching $($u.Remote)/$($u.Branch)..."
  Invoke-Git -ArgsList @('fetch', $u.Remote, $u.Branch) | Out-Null

  $upstreamSha = (Invoke-Git -ArgsList @('rev-parse', "$($u.Remote)/$($u.Branch)")).Output.Trim()
  $upstreamShort = $upstreamSha.Substring(0, 7)

  # Find last recorded git-subtree-split for this prefix
  $logRes = Invoke-Git -ArgsList @('log', "--grep=^git-subtree-dir: $($u.Prefix)/*$", '-n', '1', '--format=%B') -AllowFailure
  $lastSplit = ''
  if ($logRes.ExitCode -eq 0 -and $logRes.Output -match 'git-subtree-split:\s*([0-9a-f]{40})') {
    $lastSplit = $Matches[1]
  }

  if ($lastSplit -eq $upstreamSha) {
    Write-Host "[$($u.Name)] Already up to date with upstream ($upstreamShort)."
    continue
  }

  $aheadCount = ''
  if (-not [string]::IsNullOrWhiteSpace($lastSplit)) {
    $countRes = Invoke-Git -ArgsList @('rev-list', '--count', "$lastSplit..$upstreamSha") -AllowFailure
    if ($countRes.ExitCode -eq 0) {
      $aheadCount = " ($($countRes.Output.Trim()) new upstream commit(s))"
    }
  }

  if ($CheckOnly) {
    Write-Host "[$($u.Name)] Updates available: upstream is at $upstreamShort$aheadCount."
    continue
  }

  $beforeHead = (Invoke-Git -ArgsList @('rev-parse', 'HEAD')).Output.Trim()
  Write-Host "[$($u.Name)] Pulling upstream changes into $($u.Prefix)/$aheadCount..."

  Push-Location -LiteralPath $root
  try {
    & $git subtree pull "--prefix=$($u.Prefix)" $u.Remote $u.Branch --squash -m "Sync $($u.Prefix) from upstream ($upstreamShort)"
    if ($LASTEXITCODE -ne 0) {
      throw "git subtree pull failed for $($u.Prefix). Resolve any merge conflicts manually, commit, and retry. Local changes were NOT discarded."
    }
  }
  finally {
    Pop-Location
  }

  $afterHead = (Invoke-Git -ArgsList @('rev-parse', 'HEAD')).Output.Trim()
  if ($afterHead -ne $beforeHead) {
    $updatedPrefixes += $u.Prefix
    $changedFiles = (Invoke-Git -ArgsList @('diff', '--name-only', $beforeHead, $afterHead)).Output -split '\r?\n'
    if ($changedFiles -contains "$($u.Prefix)/package-lock.json") {
      $lockfilesChanged += $u.Prefix
    }
    Write-Host "[$($u.Name)] Successfully synced to upstream $upstreamShort."
  }
  else {
    Write-Host "[$($u.Name)] Already up to date."
  }
}

Write-Host "`n========================================================================"
if ($CheckOnly) {
  Write-Host ' Upstream check complete.'
}
elseif ($updatedPrefixes.Count -gt 0) {
  Write-Host " Updated: $($updatedPrefixes -join ', ')"
  if ($lockfilesChanged.Count -gt 0) {
    Write-Host " Lockfile changed in: $($lockfilesChanged -join ', ') (npm ci recommended)"
  }
}
else {
  Write-Host ' Both Frontend and Backend are already up to date with upstream.'
}
Write-Host '========================================================================'

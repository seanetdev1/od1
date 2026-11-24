param(
  [switch] $Alter,
  [switch] $SkipSeed,
  [switch] $PreferDocker
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'db-common.ps1')

$root = Get-OdysseyRoot
$cfg = Get-OdysseyDbConfig -ProjectRoot $root
$backendRoot = Join-Path $root 'odyssey-backend-server'

if ([string]::IsNullOrWhiteSpace($cfg.Pass) -and [string]::IsNullOrWhiteSpace($cfg.DatabaseUrl)) {
  throw "Database password is not configured. Set DB_PASS (or DATABASE_URL) in odyssey-backend-server\.env or root .env. See .env.example."
}

$runtime = Get-PostgresRuntimeMode -Config $cfg -PreferDocker:$PreferDocker
Write-Host "PostgreSQL mode detected: $($runtime.Mode)"

if ($runtime.Mode -eq 'none') {
  throw "Neither Docker Compose nor a local PostgreSQL installation was found. Install Docker Desktop (recommended) or PostgreSQL 17, then re-run."
}

if ($runtime.Mode -eq 'docker') {
  if (-not $cfg.HasRootEnv) {
    throw "Root .env is required for Docker Compose PostgreSQL. Copy .env.example to .env and set DB_PASS."
  }
  Write-Host 'Starting PostgreSQL container via Docker Compose...'
  Push-Location -LiteralPath $root
  try {
    & docker compose up -d postgres
    if ($LASTEXITCODE -ne 0) {
      throw "docker compose up -d postgres failed (exit code $LASTEXITCODE)."
    }
  }
  finally {
    Pop-Location
  }
}
elseif ($runtime.Mode -eq 'local') {
  if ($runtime.LocalService -and $runtime.LocalService.Status -ne 'Running') {
    Write-Host "Starting local Windows service '$($runtime.LocalService.Name)'..."
    Start-Service -Name $runtime.LocalService.Name
  }
}

Write-Host "Waiting for PostgreSQL at $($cfg.Host):$($cfg.Port)..."
$deadline = (Get-Date).AddSeconds(60)
while (-not (Test-TcpPortOpen -HostName $cfg.Host -Port $cfg.Port -TimeoutMs 500)) {
  if ((Get-Date) -ge $deadline) {
    throw "Timed out waiting for PostgreSQL on $($cfg.Host):$($cfg.Port)."
  }
  Start-Sleep -Milliseconds 500
}
Write-Host "PostgreSQL is accepting connections on $($cfg.Host):$($cfg.Port)."

function Ensure-DatabaseExists {
  param([string] $TargetDbName)

  if ([string]::IsNullOrWhiteSpace($TargetDbName)) { return }
  $escapedSqlLiteral = $TargetDbName.Replace("'", "''")
  $escapedIdent = $TargetDbName.Replace('"', '""')

  if ($runtime.Mode -eq 'docker') {
    Push-Location -LiteralPath $root
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $exists = (& docker compose exec -T postgres psql -U $cfg.User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$escapedSqlLiteral';" 2>&1 | ForEach-Object { $_.ToString() } | Out-String).Trim()
      $code = $LASTEXITCODE
      if ($code -ne 0) {
        throw "Could not query PostgreSQL container: $exists"
      }
      if ($exists -ne '1') {
        Write-Host "Creating missing database '$TargetDbName'..."
        & docker compose exec -T postgres psql -U $cfg.User -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE `"$escapedIdent`";"
        if ($LASTEXITCODE -ne 0) { throw "Failed to create database '$TargetDbName'." }
      }
      else {
        Write-Host "Database '$TargetDbName' already exists (preserving existing data)."
      }
    }
    finally {
      $ErrorActionPreference = $prevEap
      Pop-Location
    }
  }
  elseif ($runtime.LocalBinDir) {
    $psql = Join-Path $runtime.LocalBinDir 'psql.exe'
    $prevPgPass = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $env:PGPASSWORD = $cfg.Pass
    try {
      $exists = (& $psql -h $cfg.Host -p $cfg.Port -U $cfg.User -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$escapedSqlLiteral';" 2>&1 | ForEach-Object { $_.ToString() } | Out-String).Trim()
      $code = $LASTEXITCODE
      if ($code -ne 0) {
        throw "Could not query local PostgreSQL via psql: $exists"
      }
      if ($exists -ne '1') {
        Write-Host "Creating missing database '$TargetDbName'..."
        & $psql -h $cfg.Host -p $cfg.Port -U $cfg.User -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE `"$escapedIdent`";"
        if ($LASTEXITCODE -ne 0) { throw "Failed to create database '$TargetDbName'." }
      }
      else {
        Write-Host "Database '$TargetDbName' already exists (preserving existing data)."
      }
    }
    finally {
      $ErrorActionPreference = $prevEap
      if ($null -eq $prevPgPass) { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
      else { $env:PGPASSWORD = $prevPgPass }
    }
  }
  else {
    Write-Warning "psql CLI not found; skipping CREATE DATABASE check for '$TargetDbName'."
  }
}

Ensure-DatabaseExists -TargetDbName $cfg.Database
if (-not [string]::IsNullOrWhiteSpace($cfg.TestDatabase) -and $cfg.TestDatabase -ne $cfg.Database) {
  Ensure-DatabaseExists -TargetDbName $cfg.TestDatabase
}

# Run Odyssey Sequelize schema synchronization (safe 'create' mode by default; 'alter' only with -Alter)
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$syncMode = if ($Alter) { 'alter' } else { 'create' }
Write-Host "Running Odyssey schema sync (ODYSSEY_DB_SYNC=$syncMode) and drift check..."

$prevSync = [Environment]::GetEnvironmentVariable('ODYSSEY_DB_SYNC', 'Process')
$prevNodeEnv = [Environment]::GetEnvironmentVariable('NODE_ENV', 'Process')
$env:ODYSSEY_DB_SYNC = $syncMode
$env:NODE_ENV = if (-not [string]::IsNullOrWhiteSpace($cfg.DatabaseUrl)) { 'production' } else { 'development' }

Push-Location -LiteralPath $backendRoot
try {
  $syncScript = @"
const db = require('./models');
(async () => {
  await db.ready;
  if (db.syncError) {
    console.error('[db-init] Schema sync reported an error.');
    process.exit(1);
  }
  const missing = await db.checkSchemaDrift();
  if (missing && missing.length > 0) {
    console.warn('[db-init] Schema drift detected (' + missing.length + ' missing column(s)). Run "odyssey.bat --migrate-alter" to reconcile.');
  } else {
    console.log('[db-init] Schema check passed with no drift.');
  }
  let parentCount = 0;
  try {
    if (db.Parent_Account) {
      parentCount = await db.Parent_Account.count();
    }
  } catch (_) {
    parentCount = -1;
  }
  console.log('ODYSSEY_PARENT_ACCOUNT_COUNT=' + parentCount);
  await db.sequelize.close();
  process.exit(0);
})().catch((err) => {
  console.error('[db-init] Failed:', err.message || err);
  process.exit(1);
});
"@
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $nodeExe -e $syncScript 2>&1 | ForEach-Object { $_.ToString() }
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $prevEap
  }
  $output | ForEach-Object { Write-Host $_ }
  if ($exitCode -ne 0) {
    throw "Odyssey schema sync failed (exit code $exitCode)."
  }

  if (-not $SkipSeed) {
    $countLine = $output | Where-Object { $_ -match '^ODYSSEY_PARENT_ACCOUNT_COUNT=(\d+)$' } | Select-Object -Last 1
    if ($countLine -and ([int]$Matches[1] -eq 0)) {
      $coaScript = Join-Path $backendRoot 'scripts\seedChartOfAccounts.js'
      if (Test-Path -LiteralPath $coaScript) {
        Write-Host 'Empty Chart of Accounts detected on fresh database — seeding required Chart of Accounts...'
        & $nodeExe $coaScript --apply
        if ($LASTEXITCODE -ne 0) {
          Write-Warning "seedChartOfAccounts.js exited with code $LASTEXITCODE."
        }
      }
    }
  }
}
finally {
  Pop-Location
  if ($null -eq $prevSync) { Remove-Item Env:\ODYSSEY_DB_SYNC -ErrorAction SilentlyContinue }
  else { $env:ODYSSEY_DB_SYNC = $prevSync }
  if ($null -eq $prevNodeEnv) { Remove-Item Env:\NODE_ENV -ErrorAction SilentlyContinue }
  else { $env:NODE_ENV = $prevNodeEnv }
}

Write-Host 'Database initialization and schema check complete.'

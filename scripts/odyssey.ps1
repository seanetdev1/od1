param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $CliArgs
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'db-common.ps1')

$mode = 'dev'          # Default: dev hot-reload (3000 / 8084)
$skipUpdate = $false
$migrateAlter = $false
$actionStop = $false
$actionStatus = $false
$actionBackup = $false
$preferDocker = $false
$showHelp = $false

foreach ($arg in $CliArgs) {
  switch -Regex ($arg) {
    '^(--prod|-prod|-p)$'                  { $mode = 'prod' }
    '^(--dev|-dev|-d)$'                    { $mode = 'dev' }
    '^(--skip-update|-skipupdate|--no-update)$' { $skipUpdate = $true }
    '^(--migrate-alter|-migratealter|--alter)$' { $migrateAlter = $true }
    '^(--stop|-stop)$'                     { $actionStop = $true }
    '^(--status|-status)$'                 { $actionStatus = $true }
    '^(--backup|-backup)$'                 { $actionBackup = $true }
    '^(--docker|-docker|--prefer-docker)$' { $preferDocker = $true }
    '^(--help|-help|-h|/\?)$'              { $showHelp = $true }
    default {
      throw "Unknown option '$arg'. Run 'odyssey.bat --help' for usage."
    }
  }
}

if ($showHelp) {
  Write-Host @"
Odyssey One-Command Environment

Usage:
  odyssey.bat [options]

Modes:
  (default)        Dev hot-reload mode (Frontend: http://localhost:3000, Backend: http://localhost:8084)
  --prod           Production build mode (Frontend: http://localhost:3003, Backend: http://localhost:8088)

Options:
  --skip-update    Skip fetching upstream frontend/backend changes
  --migrate-alter  Run Sequelize schema sync with ODYSSEY_DB_SYNC=alter (opt-in)
  --docker         Prefer Docker Compose PostgreSQL when available
  --backup         Create a verified PostgreSQL backup and exit
  --status         Show PostgreSQL, backend, and frontend status and exit
  --stop           Safely stop running Odyssey backend/frontend processes and exit
  --help           Show this help message
"@
  exit 0
}

$root = Get-OdysseyRoot
$backendRoot = Join-Path $root 'odyssey-backend-server'
$frontendRoot = Join-Path $root 'odyssey-front-end'
$backendPath = (Resolve-Path -LiteralPath $backendRoot).Path
$frontendPath = (Resolve-Path -LiteralPath $frontendRoot).Path
$ports = @(3000, 3003, 8084, 8088)
$logRoot = Join-Path $env:TEMP 'odyssey-logs'

if ($actionBackup) {
  & (Join-Path $PSScriptRoot 'db-backup.ps1')
  exit 0
}

function Get-ProcessAncestry {
  param([int] $ProcessId)
  $currentId = $ProcessId
  for ($depth = 0; $depth -lt 16 -and $currentId -gt 0; $depth++) {
    $info = Get-CimInstance Win32_Process -Filter "ProcessId = $currentId" -ErrorAction SilentlyContinue
    if ($null -eq $info) { break }
    $info
    $currentId = [int]$info.ParentProcessId
  }
}

function Test-IsOdysseyProcess {
  param($ProcessInfo)
  if (-not $ProcessInfo -or [string]::IsNullOrWhiteSpace($ProcessInfo.CommandLine)) { return $false }
  $cmd = $ProcessInfo.CommandLine
  return (
    $cmd.IndexOf($backendPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    $cmd.IndexOf($frontendPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
    $cmd -match 'odyssey-backend-server' -or
    $cmd -match 'odyssey-front-end' -or
    $cmd -match '(index|server)\.js.*(-p|--port)\s+808[48]' -or
    $cmd -match 'nodemon.*index\.js' -or
    $cmd -match 'next.*(start|dev).*300[03]'
  )
}

function Stop-OdysseyProcesses {
  Write-Host 'Checking Odyssey ports (3000, 3003, 8084, 8088)...'
  $orderedToStop = New-Object System.Collections.Generic.List[int]
  $seen = @{}
  $unrelated = @()

  foreach ($port in $ports) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    foreach ($l in $listeners) {
      $procId = [int]$l.OwningProcess
      $ancestry = @(Get-ProcessAncestry -ProcessId $procId)
      $matches = @($ancestry | Where-Object { Test-IsOdysseyProcess -ProcessInfo $_ })
      if ($matches.Count -eq 0) {
        $unrelated += "port $port (PID $procId)"
        continue
      }

      # Stop parent watchers (nodemon / next) top-down first so they do not respawn children
      $ancestorsToStop = @($matches | Where-Object {
          ($_.Name -ieq 'node.exe' -or $_.Name -ieq 'cmd.exe') -and [int]$_.ProcessId -ne $procId
        })
      [Array]::Reverse($ancestorsToStop)
      foreach ($a in $ancestorsToStop) {
        $aid = [int]$a.ProcessId
        if (-not $seen.ContainsKey($aid)) {
          $seen[$aid] = $true
          $orderedToStop.Add($aid)
        }
      }
      if (-not $seen.ContainsKey($procId)) {
        $seen[$procId] = $true
        $orderedToStop.Add($procId)
      }
    }
  }

  if ($unrelated.Count -gt 0) {
    throw "Cannot safely stop non-Odyssey listeners on: $($unrelated -join ', '). Stop them manually and retry."
  }

  foreach ($procId in $orderedToStop) {
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      Write-Host "  Stopped Odyssey process $procId."
    }
  }

  foreach ($port in $ports) {
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 300
    }
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
      throw "Port $port is still occupied after stopping Odyssey processes."
    }
  }
}

if ($actionStatus) {
  $cfg = Get-OdysseyDbConfig -ProjectRoot $root
  $rt = Get-PostgresRuntimeMode -Config $cfg -PreferDocker:$preferDocker
  Write-Host '=== Odyssey Status ==='
  Write-Host ("PostgreSQL ({0}:{1}, db={2}): mode={3}, listening={4}" -f $cfg.Host, $cfg.Port, $cfg.Database, $rt.Mode, $rt.PortOpen)
  foreach ($p in @(
      @{ Port = 8084; Label = 'Backend (dev)' },
      @{ Port = 3000; Label = 'Frontend (dev)' },
      @{ Port = 8088; Label = 'Backend (prod)' },
      @{ Port = 3003; Label = 'Frontend (prod)' }
    )) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $p.Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
      $pids = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
      Write-Host ("{0,-16} : RUNNING on port {1} (PID {2})" -f $p.Label, $p.Port, $pids)
    }
    else {
      Write-Host ("{0,-16} : stopped (port {1})" -f $p.Label, $p.Port)
    }
  }
  Write-Host "Logs directory  : $logRoot"
  exit 0
}

if ($actionStop) {
  Stop-OdysseyProcesses
  Write-Host 'Odyssey processes stopped.'
  exit 0
}

Write-Host '========================================================================'
Write-Host " Odyssey — One-Command Startup ($($mode.ToUpper()) mode)"
Write-Host '========================================================================'

# 1. Validate environment configuration (never overwrite existing .env)
$cfg = Get-OdysseyDbConfig -ProjectRoot $root
if (-not $cfg.HasBackendEnv) {
  Write-Host "`n[Setup] odyssey-backend-server\.env was not found." -ForegroundColor Yellow
  Write-Host "Copy .env.example (or odyssey-backend-server\.env.example) to odyssey-backend-server\.env and set DB_PASS and JWT_SECRET."
  throw "Missing odyssey-backend-server\.env"
}

$missing = @()
if ([string]::IsNullOrWhiteSpace($cfg.DatabaseUrl) -and [string]::IsNullOrWhiteSpace($cfg.Pass)) {
  $missing += 'DB_PASS or DATABASE_URL'
}
if ([string]::IsNullOrWhiteSpace($cfg.JwtSecret)) {
  $missing += 'JWT_SECRET'
}
if ($missing.Count -gt 0) {
  throw "Backend configuration incomplete: set $($missing -join ' and ') in odyssey-backend-server\.env. See .env.example."
}

# 2. Safe upstream sync (optional, never discards uncommitted local edits)
if (-not $skipUpdate) {
  Write-Host "`n[1/5] Checking upstream Frontend & Backend updates..."
  & (Join-Path $PSScriptRoot 'update-all.ps1') -AllowDirtySkip
}
else {
  Write-Host "`n[1/5] Skipping upstream update (--skip-update)."
}

# 3. Ensure PostgreSQL is running, DB exists, and schema sync/drift check passes
Write-Host "`n[2/5] Starting PostgreSQL and checking database schema..."
& (Join-Path $PSScriptRoot 'db-init.ps1') -Alter:$migrateAlter -PreferDocker:$preferDocker

# 4. Ensure dependencies are installed
Write-Host "`n[3/5] Checking Node.js dependencies..."
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source

function Invoke-Npm {
  param([string] $WorkingDirectory, [string[]] $Arguments)
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $npmCmd @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Arguments -join ' ') failed in $WorkingDirectory (exit code $LASTEXITCODE)."
    }
  }
  finally {
    Pop-Location
  }
}

foreach ($app in @(
    @{ Path = $backendRoot; Name = 'backend'; Marker = 'node_modules\nodemon\bin\nodemon.js' },
    @{ Path = $frontendRoot; Name = 'frontend'; Marker = 'node_modules\next\dist\bin\next' }
  )) {
  if (-not (Test-Path -LiteralPath (Join-Path $app.Path $app.Marker))) {
    Write-Host "  Installing $($app.Name) dependencies (npm ci)..."
    Invoke-Npm -WorkingDirectory $app.Path -Arguments @('ci')
  }
  else {
    Write-Host "  $($app.Name) dependencies present."
  }
}

# 5. Stop prior Odyssey servers cleanly before (re)building & starting
Write-Host "`n[4/5] Preparing ports and runtime..."
Stop-OdysseyProcesses

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Wait-ForPort {
  param(
    [int] $Port,
    [System.Diagnostics.Process] $Process,
    [string] $LogPath,
    [int] $TimeoutSeconds = 90
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $Process.Refresh()
    if ($Process.HasExited) {
      $tail = ''
      if (Test-Path -LiteralPath $LogPath) {
        $tail = "`n" + ((Get-Content -LiteralPath $LogPath -Tail 25 -ErrorAction SilentlyContinue) -join "`n")
      }
      throw "Process exited (code $($Process.ExitCode)) before port $Port opened. Check $LogPath$tail"
    }
    if (Test-TcpPortOpen -HostName '127.0.0.1' -Port $Port -TimeoutMs 500) {
      return
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out after $TimeoutSeconds seconds waiting for port $Port. Check $LogPath"
}

$startedProcesses = @()

try {
  if ($mode -eq 'prod') {
    Write-Host "`n[5/5] Building and starting Odyssey in PRODUCTION mode..."
    foreach ($cachePath in @(
        (Join-Path $frontendRoot '.next'),
        (Join-Path $frontendRoot '.swc'),
        (Join-Path $frontendRoot 'node_modules\.cache'),
        (Join-Path $backendRoot 'build\dist'),
        (Join-Path $backendRoot 'node_modules\.cache')
      )) {
      if (Test-Path -LiteralPath $cachePath) {
        Remove-Item -LiteralPath $cachePath -Recurse -Force
      }
    }
    Invoke-Npm -WorkingDirectory $backendRoot -Arguments @('run', 'build')
    Invoke-Npm -WorkingDirectory $frontendRoot -Arguments @('run', 'build')

    $backendOut = Join-Path $logRoot 'backend-prod.out.log'
    $backendErr = Join-Path $logRoot 'backend-prod.err.log'
    $frontendOut = Join-Path $logRoot 'frontend-prod.out.log'
    $frontendErr = Join-Path $logRoot 'frontend-prod.err.log'
    $backendEntry = Join-Path $backendRoot 'index.js'
    $frontendCli = Join-Path $frontendRoot 'node_modules\next\dist\bin\next'

    $backendNodeEnv = if (-not [string]::IsNullOrWhiteSpace($cfg.DatabaseUrl)) { 'production' } else { 'development' }
    $prevNodeEnv = [Environment]::GetEnvironmentVariable('NODE_ENV', 'Process')
    $env:NODE_ENV = $backendNodeEnv
    try {
      Write-Host '  Starting backend on http://localhost:8088 ...'
      $backendProc = Start-Process -FilePath $nodeExe `
        -ArgumentList @("`"$backendEntry`"", '-p', '8088') `
        -WorkingDirectory $backendRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $backendOut `
        -RedirectStandardError $backendErr `
        -PassThru
    }
    finally {
      if ($null -eq $prevNodeEnv) { Remove-Item Env:\NODE_ENV -ErrorAction SilentlyContinue }
      else { $env:NODE_ENV = $prevNodeEnv }
    }
    $startedProcesses += $backendProc
    Wait-ForPort -Port 8088 -Process $backendProc -LogPath $backendErr -TimeoutSeconds 90

    Write-Host '  Starting frontend on http://localhost:3003 ...'
    $frontendProc = Start-Process -FilePath $nodeExe `
      -ArgumentList @("`"$frontendCli`"", 'start', '-p', '3003') `
      -WorkingDirectory $frontendRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $frontendOut `
      -RedirectStandardError $frontendErr `
      -PassThru
    $startedProcesses += $frontendProc
    Wait-ForPort -Port 3003 -Process $frontendProc -LogPath $frontendErr -TimeoutSeconds 60

    $frontendUrl = 'http://localhost:3003'
    $backendUrl = 'http://localhost:8088'
  }
  else {
    Write-Host "`n[5/5] Starting Odyssey in DEV hot-reload mode..."
    $backendOut = Join-Path $logRoot 'backend-dev.out.log'
    $backendErr = Join-Path $logRoot 'backend-dev.err.log'
    $frontendOut = Join-Path $logRoot 'frontend-dev.out.log'
    $frontendErr = Join-Path $logRoot 'frontend-dev.err.log'
    $nodemonCli = Join-Path $backendRoot 'node_modules\nodemon\bin\nodemon.js'
    $frontendCli = Join-Path $frontendRoot 'node_modules\next\dist\bin\next'

    $prevNodeEnv = [Environment]::GetEnvironmentVariable('NODE_ENV', 'Process')
    $env:NODE_ENV = 'development'
    try {
      Write-Host '  Starting backend (nodemon) on http://localhost:8084 ...'
      $backendProc = Start-Process -FilePath $nodeExe `
        -ArgumentList @("`"$nodemonCli`"", 'index.js') `
        -WorkingDirectory $backendRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $backendOut `
        -RedirectStandardError $backendErr `
        -PassThru
    }
    finally {
      if ($null -eq $prevNodeEnv) { Remove-Item Env:\NODE_ENV -ErrorAction SilentlyContinue }
      else { $env:NODE_ENV = $prevNodeEnv }
    }
    $startedProcesses += $backendProc
    Wait-ForPort -Port 8084 -Process $backendProc -LogPath $backendErr -TimeoutSeconds 90

    Write-Host '  Starting frontend (next dev --webpack) on http://localhost:3000 ...'
    $frontendProc = Start-Process -FilePath $nodeExe `
      -ArgumentList @("`"$frontendCli`"", 'dev', '--webpack', '-p', '3000') `
      -WorkingDirectory $frontendRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $frontendOut `
      -RedirectStandardError $frontendErr `
      -PassThru
    $startedProcesses += $frontendProc
    Wait-ForPort -Port 3000 -Process $frontendProc -LogPath $frontendErr -TimeoutSeconds 120

    $frontendUrl = 'http://localhost:3000'
    $backendUrl = 'http://localhost:8084'
  }
}
catch {
  foreach ($p in $startedProcesses) {
    if (-not $p.HasExited) {
      Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
  }
  throw
}

Write-Host ''
Write-Host '========================================================================'
Write-Host " Odyssey is running ($($mode.ToUpper()) mode)"
Write-Host '========================================================================'
Write-Host "  Frontend : $frontendUrl"
Write-Host "  Backend  : $backendUrl"
Write-Host "  Database : $($cfg.Database) ($($cfg.Host):$($cfg.Port))"
Write-Host "  Logs     : $logRoot"
Write-Host '  Stop     : odyssey.bat --stop'
Write-Host '========================================================================'

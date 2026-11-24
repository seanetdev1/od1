$ErrorActionPreference = 'Stop'

$projectRoot = $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'odyssey-backend-server'
$frontendRoot = Join-Path $projectRoot 'odyssey-front-end'
$backendPath = (Resolve-Path -LiteralPath $backendRoot).Path
$frontendPath = (Resolve-Path -LiteralPath $frontendRoot).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$ports = @(3000, 3003, 8084, 8088)
$backendEnvFile = Join-Path $backendRoot '.env'

function Test-BackendSetting {
  param([string] $Name)

  $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    return $true
  }
  if (-not (Test-Path -LiteralPath $backendEnvFile)) {
    return $false
  }

  $contents = [System.IO.File]::ReadAllText($backendEnvFile)
  $pattern = '(?m)^[ \t]*' + [regex]::Escape($Name) + '[ \t]*=[ \t]*([^\r\n]*)\r?$'
  $matches = [regex]::Matches($contents, $pattern)
  if ($matches.Count -eq 0) {
    return $false
  }

  $setting = $matches[$matches.Count - 1].Groups[1].Value.Trim()
  if ($setting.Length -ge 2 -and
      (($setting[0] -eq '"' -and $setting[$setting.Length - 1] -eq '"') -or
       ($setting[0] -eq "'" -and $setting[$setting.Length - 1] -eq "'"))) {
    $setting = $setting.Substring(1, $setting.Length - 2)
  }
  else {
    $setting = [regex]::Replace($setting, '[ \t]+#.*$', '')
  }
  return -not [string]::IsNullOrWhiteSpace($setting)
}

$hasDatabaseUrl = Test-BackendSetting -Name 'DATABASE_URL'
$hasDatabasePassword = Test-BackendSetting -Name 'DB_PASS'
$hasJwtSecret = Test-BackendSetting -Name 'JWT_SECRET'
$missingBackendSettings = @()
if (-not $hasDatabaseUrl -and -not $hasDatabasePassword) {
  $missingBackendSettings += 'DB_PASS or DATABASE_URL'
}
if (-not $hasJwtSecret) {
  $missingBackendSettings += 'JWT_SECRET'
}
if ($missingBackendSettings.Count -gt 0) {
  throw "Backend configuration is incomplete: set $($missingBackendSettings -join ' and ') in $backendEnvFile or the environment before running. See $backendRoot\.env.example. No ports, caches, or build outputs were changed."
}

$backendNodeEnv = if ($hasDatabaseUrl) { 'production' } else { 'development' }

function Get-ProcessAncestry {
  param([int] $ProcessId)

  $currentId = $ProcessId
  for ($depth = 0; $depth -lt 16 -and $currentId -gt 0; $depth++) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $currentId" -ErrorAction SilentlyContinue
    if ($null -eq $processInfo) {
      break
    }
    $processInfo
    $currentId = [int] $processInfo.ParentProcessId
  }
}

function Test-IsOdysseyProcess {
  param($ProcessInfo)

  if (-not $ProcessInfo -or [string]::IsNullOrWhiteSpace($ProcessInfo.CommandLine)) {
    return $false
  }

  $cmd = $ProcessInfo.CommandLine
  if ($cmd.IndexOf($backendPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $cmd.IndexOf($frontendPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -or
      $cmd -match 'odyssey-backend-server' -or
      $cmd -match 'odyssey-front-end' -or
      $cmd -match '(index|server)\.js.*(-p|--port)\s+808[48]' -or
      $cmd -match 'next.*(start|dev).*300[03]') {
    return $true
  }

  return $false
}

Write-Host 'Checking Odyssey ports (3000, 3003, 8084, 8088)...'
$orderedToStop = New-Object System.Collections.Generic.List[int]
$seenToStop = @{}
$unrelatedListeners = @()

foreach ($port in $ports) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  foreach ($listener in $listeners) {
    $processId = [int] $listener.OwningProcess
    $ancestry = @(Get-ProcessAncestry -ProcessId $processId)
    $odysseyMatches = @($ancestry | Where-Object { Test-IsOdysseyProcess -ProcessInfo $_ })

    if ($odysseyMatches.Count -eq 0) {
      $unrelatedListeners += "port $port (PID $processId)"
      continue
    }

    # Stop Odyssey watcher/runner ancestors (top-down) before the listener so nodemon/next won't respawn it.
    $ancestorsToStop = @($odysseyMatches | Where-Object {
        $_.Name -ieq 'node.exe' -and [int] $_.ProcessId -ne $processId
      })
    [Array]::Reverse($ancestorsToStop)

    foreach ($ancestor in $ancestorsToStop) {
      $aid = [int] $ancestor.ProcessId
      if (-not $seenToStop.ContainsKey($aid)) {
        $seenToStop[$aid] = $true
        $orderedToStop.Add($aid)
      }
    }

    if (-not $seenToStop.ContainsKey($processId)) {
      $seenToStop[$processId] = $true
      $orderedToStop.Add($processId)
    }
  }
}

if ($unrelatedListeners.Count -gt 0) {
  throw "Cannot safely free ports occupied by non-Odyssey processes: $($unrelatedListeners -join ', '). Stop those processes manually, then retry."
}

foreach ($processId in $orderedToStop) {
  if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped existing Odyssey process $processId."
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

Write-Host "`nClearing generated build outputs and caches..."
$cachePaths = @(
  (Join-Path $frontendRoot '.next'),
  (Join-Path $frontendRoot '.swc'),
  (Join-Path $frontendRoot 'node_modules\.cache'),
  (Join-Path $backendRoot 'build\dist'),
  (Join-Path $backendRoot 'node_modules\.cache')
)
foreach ($cachePath in $cachePaths) {
  if (Test-Path -LiteralPath $cachePath) {
    Remove-Item -LiteralPath $cachePath -Recurse -Force
    Write-Host "Cleared $cachePath"
  }
}

foreach ($dir in @($backendRoot, $frontendRoot)) {
  Get-ChildItem -Path $dir -Filter '*.tsbuildinfo' -File -ErrorAction SilentlyContinue |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force
      Write-Host "Cleared $($_.FullName)"
    }
}

function Invoke-Npm {
  param(
    [string] $WorkingDirectory,
    [string[]] $Arguments
  )

  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $npm @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Arguments -join ' ') failed in $WorkingDirectory (exit code $LASTEXITCODE)."
    }
  }
  finally {
    Pop-Location
  }
}

foreach ($app in @(
    @{ Path = $backendRoot; Name = 'backend' },
    @{ Path = $frontendRoot; Name = 'frontend' }
  )) {
  $dependenciesPresent = if ($app.Name -eq 'backend') {
    (Test-Path -LiteralPath (Join-Path $app.Path 'node_modules\esbuild\package.json')) -and
      (Test-Path -LiteralPath (Join-Path $app.Path 'node_modules\javascript-obfuscator\package.json')) -and
      (Test-Path -LiteralPath (Join-Path $app.Path 'node_modules\bytenode\package.json'))
  }
  else {
    Test-Path -LiteralPath (Join-Path $app.Path 'node_modules\next\dist\bin\next')
  }

  if (-not $dependenciesPresent) {
    Write-Host "`nInstalling $($app.Name) dependencies..."
    Invoke-Npm -WorkingDirectory $app.Path -Arguments @('ci')
  }
}

Write-Host "`nBuilding Odyssey-latest backend from base..."
Invoke-Npm -WorkingDirectory $backendRoot -Arguments @('run', 'build')

Write-Host "`nBuilding Odyssey-latest frontend from base..."
Invoke-Npm -WorkingDirectory $frontendRoot -Arguments @('run', 'build')

$logRoot = Join-Path $env:TEMP 'od-latest-logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$backendOut = Join-Path $logRoot 'backend.out.log'
$backendErr = Join-Path $logRoot 'backend.err.log'
$frontendOut = Join-Path $logRoot 'frontend.out.log'
$frontendErr = Join-Path $logRoot 'frontend.err.log'
$backendEntry = Join-Path $backendRoot 'index.js'
$frontendCli = Join-Path $frontendRoot 'node_modules\next\dist\bin\next'
$startedProcesses = @()

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

    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $connect = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
      if ($connect.AsyncWaitHandle.WaitOne(500) -and $client.Connected) {
        return
      }
    }
    catch {
      # Not listening yet.
    }
    finally {
      $client.Close()
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Timed out after $TimeoutSeconds seconds waiting for port $Port. Check $LogPath"
}

try {
  Write-Host "`nStarting Odyssey-latest backend on port 8088..."
  $previousNodeEnv = [Environment]::GetEnvironmentVariable('NODE_ENV', 'Process')
  $env:NODE_ENV = $backendNodeEnv
  try {
    $backendProcess = Start-Process -FilePath $node `
      -ArgumentList @("`"$backendEntry`"", '-p', '8088') `
      -WorkingDirectory $backendRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $backendOut `
      -RedirectStandardError $backendErr `
      -PassThru
  }
  finally {
    if ($null -eq $previousNodeEnv) {
      Remove-Item Env:\NODE_ENV -ErrorAction SilentlyContinue
    }
    else {
      $env:NODE_ENV = $previousNodeEnv
    }
  }
  $startedProcesses += $backendProcess
  Wait-ForPort -Port 8088 -Process $backendProcess -LogPath $backendErr -TimeoutSeconds 90

  Write-Host 'Starting Odyssey-latest frontend on port 3003...'
  $frontendProcess = Start-Process -FilePath $node `
    -ArgumentList @("`"$frontendCli`"", 'start', '-p', '3003') `
    -WorkingDirectory $frontendRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $frontendOut `
    -RedirectStandardError $frontendErr `
    -PassThru
  $startedProcesses += $frontendProcess
  Wait-ForPort -Port 3003 -Process $frontendProcess -LogPath $frontendErr -TimeoutSeconds 60
}
catch {
  foreach ($process in $startedProcesses) {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
  throw
}

Write-Host ''
Write-Host 'Odyssey-latest rebuild and startup complete:'
Write-Host '  Frontend: http://localhost:3003'
Write-Host '  Backend:  http://localhost:8088'
Write-Host "  Logs:     $logRoot"

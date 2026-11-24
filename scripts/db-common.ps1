# Shared environment & PostgreSQL detection helpers for Odyssey scripts.

Set-StrictMode -Version Latest

function Get-OdysseyRoot {
  return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
}

function Read-DotEnvFile {
  param([string] $Path)

  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $map
  }

  $lines = Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue
  foreach ($line in $lines) {
    if ($null -eq $line) { continue }
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
    $m = [regex]::Match($trimmed, '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
    if (-not $m.Success) { continue }

    $key = $m.Groups[1].Value
    $val = $m.Groups[2].Value.Trim()
    if ($val.Length -ge 2 -and (
        ($val.StartsWith('"') -and $val.EndsWith('"')) -or
        ($val.StartsWith("'") -and $val.EndsWith("'")))) {
      $val = $val.Substring(1, $val.Length - 2)
    }
    else {
      $val = [regex]::Replace($val, '\s+#.*$', '').Trim()
    }
    $map[$key] = $val
  }
  return $map
}

function Get-OdysseyDbConfig {
  param([string] $ProjectRoot = (Get-OdysseyRoot))

  $rootEnv = Read-DotEnvFile -Path (Join-Path $ProjectRoot '.env')
  $backendEnv = Read-DotEnvFile -Path (Join-Path $ProjectRoot 'odyssey-backend-server\.env')

  $get = {
    param([string] $Key, [string] $Default = '')
    $procVal = [Environment]::GetEnvironmentVariable($Key, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($procVal)) { return $procVal }
    if ($backendEnv.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace($backendEnv[$Key])) { return $backendEnv[$Key] }
    if ($rootEnv.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace($rootEnv[$Key])) { return $rootEnv[$Key] }
    return $Default
  }

  $databaseUrl = & $get 'DATABASE_URL' ''
  $hostName = & $get 'DB_HOST' '127.0.0.1'
  $port = [int](& $get 'DB_PORT' '5432')
  $user = & $get 'DB_USER' 'postgres'
  $pass = & $get 'DB_PASS' ''
  $dbName = & $get 'DB_NAME' 'odyssey-dev'
  $dbNameTest = & $get 'DB_NAME_TEST' 'odyssey-test'
  $jwtSecret = & $get 'JWT_SECRET' ''
  $dbSync = & $get 'ODYSSEY_DB_SYNC' 'create'

  if (-not [string]::IsNullOrWhiteSpace($databaseUrl)) {
    try {
      $uri = [System.Uri]$databaseUrl
      if ($uri.Host) { $hostName = $uri.Host }
      if ($uri.Port -gt 0) { $port = $uri.Port }
      if ($uri.UserInfo) {
        $parts = $uri.UserInfo.Split(':', 2)
        if ($parts.Length -ge 1 -and $parts[0]) { $user = [System.Uri]::UnescapeDataString($parts[0]) }
        if ($parts.Length -ge 2 -and $parts[1]) { $pass = [System.Uri]::UnescapeDataString($parts[1]) }
      }
      $pathDb = $uri.AbsolutePath.TrimStart('/')
      if ($pathDb) { $dbName = $pathDb }
    }
    catch {
      # Keep discrete values if URL parsing fails.
    }
  }

  return [PSCustomObject]@{
    ProjectRoot      = $ProjectRoot
    RootEnvPath      = Join-Path $ProjectRoot '.env'
    BackendEnvPath   = Join-Path $ProjectRoot 'odyssey-backend-server\.env'
    HasRootEnv       = Test-Path -LiteralPath (Join-Path $ProjectRoot '.env')
    HasBackendEnv    = Test-Path -LiteralPath (Join-Path $ProjectRoot 'odyssey-backend-server\.env')
    DatabaseUrl      = $databaseUrl
    Host             = $hostName
    Port             = $port
    User             = $user
    Pass             = $pass
    Database         = $dbName
    TestDatabase     = $dbNameTest
    JwtSecret        = $jwtSecret
    DbSync           = $dbSync
  }
}

function Find-LocalPostgresBinDir {
  $psqlOnPath = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($psqlOnPath) {
    return (Split-Path -Parent $psqlOnPath.Source)
  }

  $pgRoot = 'C:\Program Files\PostgreSQL'
  if (Test-Path -LiteralPath $pgRoot) {
    $versions = Get-ChildItem -LiteralPath $pgRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object {
        $n = 0
        if ([int]::TryParse($_.Name, [ref]$n)) { $n } else { 0 }
      } -Descending
    foreach ($ver in $versions) {
      $bin = Join-Path $ver.FullName 'bin'
      if (Test-Path -LiteralPath (Join-Path $bin 'psql.exe')) {
        return $bin
      }
    }
  }
  return $null
}

function Get-LocalPostgresService {
  $svcs = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue)
  if ($svcs.Count -eq 0) { return $null }
  $running = $svcs | Where-Object { $_.Status -eq 'Running' } | Select-Object -First 1
  if ($running) { return $running }
  return ($svcs | Select-Object -First 1)
}

function Test-DockerAvailable {
  $dockerCmd = Get-Command docker.exe -ErrorAction SilentlyContinue
  if (-not $dockerCmd) { $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue }
  if (-not $dockerCmd) { return $false }

  try {
    & $dockerCmd.Source info *> $null
    if ($LASTEXITCODE -ne 0) { return $false }
    & $dockerCmd.Source compose version *> $null
    return ($LASTEXITCODE -eq 0)
  }
  catch {
    return $false
  }
}

function Test-DockerPostgresRunning {
  param([string] $ProjectRoot = (Get-OdysseyRoot))

  if (-not (Test-DockerAvailable)) { return $false }
  Push-Location -LiteralPath $ProjectRoot
  try {
    $cid = (& docker compose ps -q postgres 2>$null | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($cid)) { return $false }
    $state = (& docker inspect -f '{{.State.Running}}' $cid 2>$null | Out-String).Trim()
    return ($state -eq 'true')
  }
  finally {
    Pop-Location
  }
}

function Test-TcpPortOpen {
  param(
    [string] $HostName = '127.0.0.1',
    [int] $Port = 5432,
    [int] $TimeoutMs = 500
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connect = $client.BeginConnect($HostName, $Port, $null, $null)
    if ($connect.AsyncWaitHandle.WaitOne($TimeoutMs) -and $client.Connected) {
      return $true
    }
    return $false
  }
  catch {
    return $false
  }
  finally {
    $client.Close()
  }
}

function Get-PostgresRuntimeMode {
  param(
    [PSCustomObject] $Config,
    [switch] $PreferDocker
  )

  $dockerOk = Test-DockerAvailable
  $dockerRunning = if ($dockerOk) { Test-DockerPostgresRunning -ProjectRoot $Config.ProjectRoot } else { $false }
  $localSvc = Get-LocalPostgresService
  $localBin = Find-LocalPostgresBinDir
  $portOpen = Test-TcpPortOpen -HostName $Config.Host -Port $Config.Port

  if ($dockerRunning) {
    return [PSCustomObject]@{
      Mode         = 'docker'
      DockerOk     = $dockerOk
      LocalService = $localSvc
      LocalBinDir  = $localBin
      PortOpen     = $portOpen
    }
  }

  # If local PostgreSQL service is already running on this machine, use it rather than colliding on port 5432.
  if ($localSvc -and $localSvc.Status -eq 'Running' -and -not $PreferDocker) {
    return [PSCustomObject]@{
      Mode         = 'local'
      DockerOk     = $dockerOk
      LocalService = $localSvc
      LocalBinDir  = $localBin
      PortOpen     = $portOpen
    }
  }

  # If Docker is available and no local service is blocking the port, use Docker Compose PostgreSQL.
  if ($dockerOk -and ($PreferDocker -or -not $portOpen)) {
    return [PSCustomObject]@{
      Mode         = 'docker'
      DockerOk     = $dockerOk
      LocalService = $localSvc
      LocalBinDir  = $localBin
      PortOpen     = $portOpen
    }
  }

  if ($localSvc -or $localBin -or $portOpen) {
    return [PSCustomObject]@{
      Mode         = 'local'
      DockerOk     = $dockerOk
      LocalService = $localSvc
      LocalBinDir  = $localBin
      PortOpen     = $portOpen
    }
  }

  return [PSCustomObject]@{
    Mode         = 'none'
    DockerOk     = $false
    LocalService = $null
    LocalBinDir  = $null
    PortOpen     = $false
  }
}

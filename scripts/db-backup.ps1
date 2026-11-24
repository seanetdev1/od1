param(
  [string] $Tag = '',
  [switch] $SkipVerify
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'db-common.ps1')

$root = Get-OdysseyRoot
$cfg = Get-OdysseyDbConfig -ProjectRoot $root
$runtime = Get-PostgresRuntimeMode -Config $cfg

if ([string]::IsNullOrWhiteSpace($cfg.Pass) -and [string]::IsNullOrWhiteSpace($cfg.DatabaseUrl)) {
  throw "Database password is not configured. Set DB_PASS (or DATABASE_URL) in odyssey-backend-server\.env or root .env."
}

$backupsDir = Join-Path $root 'backups'
New-Item -ItemType Directory -Path $backupsDir -Force | Out-Null

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$safeDb = ($cfg.Database -replace '[^A-Za-z0-9._-]', '_')
$suffix = if ([string]::IsNullOrWhiteSpace($Tag)) { '' } else { "_$($Tag -replace '[^A-Za-z0-9._-]', '_')" }
$fileName = "${safeDb}_${stamp}${suffix}.dump"
$outFile = Join-Path $backupsDir $fileName

Write-Host "Backing up database '$($cfg.Database)' ($($cfg.Host):$($cfg.Port), mode=$($runtime.Mode))..."
Write-Host "Target: $outFile"

if ($runtime.Mode -eq 'docker') {
  Push-Location -LiteralPath $root
  try {
    & docker compose exec -T postgres pg_dump -U $cfg.User -F c -f "/backups/$fileName" $cfg.Database
    if ($LASTEXITCODE -ne 0) {
      throw "Docker pg_dump failed (exit code $LASTEXITCODE)."
    }
    if (-not $SkipVerify) {
      Write-Host 'Verifying backup archive...'
      & docker compose exec -T postgres pg_restore --list "/backups/$fileName" > $null
      if ($LASTEXITCODE -ne 0) {
        throw "Backup verification (pg_restore --list) failed."
      }
    }
  }
  finally {
    Pop-Location
  }
}
elseif ($runtime.Mode -eq 'local' -and $runtime.LocalBinDir) {
  $pgDump = Join-Path $runtime.LocalBinDir 'pg_dump.exe'
  $pgRestore = Join-Path $runtime.LocalBinDir 'pg_restore.exe'
  $prevPgPass = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
  $env:PGPASSWORD = $cfg.Pass
  try {
    & $pgDump -h $cfg.Host -p $cfg.Port -U $cfg.User -F c -f $outFile $cfg.Database
    if ($LASTEXITCODE -ne 0) {
      throw "pg_dump failed (exit code $LASTEXITCODE)."
    }
    if (-not $SkipVerify -and (Test-Path -LiteralPath $pgRestore)) {
      Write-Host 'Verifying backup archive...'
      & $pgRestore --list $outFile > $null
      if ($LASTEXITCODE -ne 0) {
        throw "Backup verification (pg_restore --list) failed."
      }
    }
  }
  finally {
    if ($null -eq $prevPgPass) { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
    else { $env:PGPASSWORD = $prevPgPass }
  }
}
else {
  throw "Could not locate pg_dump (neither Docker PostgreSQL nor local PostgreSQL client tools found)."
}

$sizeMb = [Math]::Round(((Get-Item -LiteralPath $outFile).Length / 1MB), 2)
Write-Host "Backup complete: $outFile ($sizeMb MB)"
return $outFile

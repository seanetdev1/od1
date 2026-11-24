param(
  [string] $BackupFile = '',
  [switch] $SkipPreBackup
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'db-common.ps1')

$root = Get-OdysseyRoot
$cfg = Get-OdysseyDbConfig -ProjectRoot $root
$runtime = Get-PostgresRuntimeMode -Config $cfg
$backupsDir = Join-Path $root 'backups'

if ([string]::IsNullOrWhiteSpace($BackupFile)) {
  $files = @(Get-ChildItem -LiteralPath $backupsDir -Filter '*.dump' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($files.Count -eq 0) {
    throw "No .dump backup files found in $backupsDir. Run db-backup.bat first or pass a backup path."
  }

  Write-Host 'Available backups (newest first):'
  for ($i = 0; $i -lt $files.Count; $i++) {
    $mb = [Math]::Round(($files[$i].Length / 1MB), 2)
    Write-Host ("  [{0}] {1}  ({2} MB, {3})" -f ($i + 1), $files[$i].Name, $mb, $files[$i].LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss'))
  }
  $choice = Read-Host 'Select backup number to restore (or press Enter to cancel)'
  if ([string]::IsNullOrWhiteSpace($choice)) {
    Write-Host 'Restore cancelled.'
    exit 0
  }
  $idx = 0
  if (-not [int]::TryParse($choice, [ref]$idx) -or $idx -lt 1 -or $idx -gt $files.Count) {
    throw "Invalid selection '$choice'."
  }
  $BackupFile = $files[$idx - 1].FullName
}
else {
  if (-not (Test-Path -LiteralPath $BackupFile)) {
    $candidate = Join-Path $backupsDir $BackupFile
    if (Test-Path -LiteralPath $candidate) { $BackupFile = $candidate }
  }
  if (-not (Test-Path -LiteralPath $BackupFile)) {
    throw "Backup file not found: $BackupFile"
  }
  $BackupFile = (Resolve-Path -LiteralPath $BackupFile).Path
}

Write-Host ''
Write-Host '========================================================================' -ForegroundColor Yellow
Write-Host ' WARNING: DATABASE RESTORE WILL OVERWRITE EXISTING DATA' -ForegroundColor Yellow
Write-Host '========================================================================' -ForegroundColor Yellow
Write-Host "  Target DB:   $($cfg.Database) ($($cfg.Host):$($cfg.Port), mode=$($runtime.Mode))"
Write-Host "  Backup File: $BackupFile"
Write-Host ''

$confirmation = Read-Host "Type RESTORE to overwrite '$($cfg.Database)' (anything else cancels)"
if ($confirmation -cne 'RESTORE') {
  Write-Host 'Restore cancelled. No database changes were made.'
  exit 0
}

if (-not $SkipPreBackup) {
  Write-Host "`nCreating safety pre-restore backup first..."
  & (Join-Path $PSScriptRoot 'db-backup.ps1') -Tag 'pre-restore'
}

Write-Host "`nRestoring '$BackupFile' into '$($cfg.Database)'..."
if ($runtime.Mode -eq 'docker') {
  $fileName = Split-Path -Leaf $BackupFile
  $inBackupsDir = $BackupFile.StartsWith($backupsDir, [System.StringComparison]::OrdinalIgnoreCase)
  Push-Location -LiteralPath $root
  try {
    if ($inBackupsDir) {
      & docker compose exec -T postgres pg_restore -U $cfg.User -d $cfg.Database --clean --if-exists --no-owner --no-privileges "/backups/$fileName"
    }
    else {
      Get-Content -LiteralPath $BackupFile -Encoding Byte -Raw | Out-Null
      $cmd = "docker compose exec -T postgres pg_restore -U $($cfg.User) -d $($cfg.Database) --clean --if-exists --no-owner --no-privileges < `"$BackupFile`""
      cmd /c $cmd
    }
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "pg_restore exited with code $LASTEXITCODE (non-fatal warnings can occur on clean restore; inspect output above)."
    }
  }
  finally {
    Pop-Location
  }
}
elseif ($runtime.Mode -eq 'local' -and $runtime.LocalBinDir) {
  $pgRestore = Join-Path $runtime.LocalBinDir 'pg_restore.exe'
  $prevPgPass = [Environment]::GetEnvironmentVariable('PGPASSWORD', 'Process')
  $env:PGPASSWORD = $cfg.Pass
  try {
    & $pgRestore -h $cfg.Host -p $cfg.Port -U $cfg.User -d $cfg.Database --clean --if-exists --no-owner --no-privileges $BackupFile
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "pg_restore exited with code $LASTEXITCODE (non-fatal warnings can occur on clean restore; inspect output above)."
    }
  }
  finally {
    if ($null -eq $prevPgPass) { Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue }
    else { $env:PGPASSWORD = $prevPgPass }
  }
}
else {
  throw "Could not locate pg_restore (neither Docker PostgreSQL nor local PostgreSQL client tools found)."
}

Write-Host "`nDatabase restore complete."

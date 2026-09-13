# Run only on a disposable Windows test machine: installs and uninstalls LayerProof.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This test requires Windows.' }
$registryRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Find-App {
  if (!(Test-Path $registryRoot)) { return @() }
  @(Get-ChildItem $registryRoot | Get-ItemProperty | Where-Object { $_.DisplayName -in @('LayerProof','PDF OCR QC') })
}
if ((Find-App).Count) { throw 'Use a disposable machine without an existing LayerProof/PDF OCR QC installation.' }
$installer = Get-ChildItem "$PSScriptRoot/../dist/LayerProof Setup *.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (!$installer) { throw 'Build the Windows installer first.' }
$root = Join-Path $env:TEMP ('layerproof-install-test-' + [guid]::NewGuid())
$installDir = Join-Path $root 'application'
$documents = Join-Path $root 'documents'
New-Item -ItemType Directory -Path $documents -Force | Out-Null
$sentinel = Join-Path $documents 'project-data.txt'
Set-Content $sentinel 'Preserve project files'
$historyDir = Join-Path $env:APPDATA 'PDF OCR QC'
New-Item -ItemType Directory -Path $historyDir -Force | Out-Null
$history = Join-Path $historyDir ('uninstall-test-' + [guid]::NewGuid() + '.json')
Set-Content $history '{"preserve":true}'
$desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'LayerProof.lnk'
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'LayerProof.lnk'
$p = Start-Process $installer.FullName -ArgumentList @('/S', '/currentuser', "/D=$installDir") -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Install failed: $($p.ExitCode)" }
foreach ($file in @((Join-Path $installDir 'LayerProof.exe'), (Join-Path $installDir 'Uninstall LayerProof.exe'), $desktop, $startMenu)) {
  if (!(Test-Path $file)) { throw "Install did not create $file" }
}
$entry = Find-App
if ($entry.Count -ne 1 -or $entry[0].DisplayName -ne 'LayerProof' -or !$entry[0].UninstallString) { throw 'Incorrect Installed apps entry.' }
$p = Start-Process (Join-Path $installDir 'Uninstall LayerProof.exe') -ArgumentList @('/S','/currentuser') -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Uninstall failed: $($p.ExitCode)" }
# NSIS may delegate removal to a temporary executable.
$deadline = (Get-Date).AddSeconds(60)
do {
  $remaining = (Test-Path $installDir) -or (Test-Path $desktop) -or (Test-Path $startMenu) -or ((Find-App).Count -gt 0)
  if (!$remaining) { break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
if ($remaining) { throw 'Uninstall left the app directory, shortcuts, or registry entry behind.' }
if ((Get-Content $sentinel -Raw).Trim() -ne 'Preserve project files') { throw 'Project data was changed.' }
if ((Get-Content $history -Raw).Trim() -ne '{"preserve":true}') { throw 'Review history was changed.' }
Remove-Item $history
Remove-Item $root -Recurse
Write-Output 'PASS: install, shortcuts, registration, uninstall, project data and review history preservation.'

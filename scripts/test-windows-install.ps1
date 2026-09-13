# Run only on a disposable Windows test machine: installs and uninstalls LayerProof.
param([string]$PreviousInstaller, [switch]$RequireSigned, [string]$ExpectedPublisher)
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
$settingsFile = Join-Path $historyDir 'settings.json'
$draftFile = Join-Path $historyDir 'draft-upgrade-test.json'
if ((Test-Path $settingsFile) -or (Test-Path $draftFile)) { throw 'Use a fresh disposable profile for upgrade tests.' }
Set-Content $settingsFile '{"reviewer":"Upgrade Test","lastProject":{"workbook":"test.xlsx","folder":"test-pdfs"}}'
Set-Content $draftFile '{"concerns":"Keep unfinished review","checked":[1],"viewRotations":[[1,90]]}'
$settingsHash = (Get-FileHash $settingsFile).Hash
$draftHash = (Get-FileHash $draftFile).Hash
if ($PreviousInstaller) {
  $prior = Start-Process $PreviousInstaller -ArgumentList @('/S','/currentuser',"/D=$installDir") -Wait -PassThru
  if ($prior.ExitCode -ne 0) { throw 'Previous version installation failed.' }
  $priorEntry = Find-App
  if ($priorEntry.Count -ne 1) { throw 'Previous version did not register.' }
  $priorVersion = $priorEntry[0].DisplayVersion
}
$p = Start-Process $installer.FullName -ArgumentList @('/S', '/currentuser', "/D=$installDir") -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "Install failed: $($p.ExitCode)" }
foreach ($file in @((Join-Path $installDir 'LayerProof.exe'), (Join-Path $installDir 'Uninstall LayerProof.exe'), $desktop, $startMenu)) {
  if (!(Test-Path $file)) { throw "Install did not create $file" }
}
if ($RequireSigned) {
  if (!$ExpectedPublisher) { throw 'Expected publisher is required for signed builds.' }
  foreach ($signedFile in @($installer.FullName, (Join-Path $installDir 'LayerProof.exe'), (Join-Path $installDir 'Uninstall LayerProof.exe'))) {
    $signature = Get-AuthenticodeSignature $signedFile
    if ($signature.Status -ne 'Valid' -or !$signature.TimeStamperCertificate) { throw "Missing valid timestamped signature: $signedFile" }
    $actualPublisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($actualPublisher -cne $ExpectedPublisher) { throw "Unexpected publisher on $signedFile" }
  }
  Write-Output 'PASS: installer, application and uninstaller carry valid timestamped publisher signatures.'
}
$entry = Find-App
if ($entry.Count -ne 1 -or $entry[0].DisplayName -ne 'LayerProof' -or !$entry[0].UninstallString) { throw 'Incorrect Installed apps entry.' }
$expectedVersion = (Get-Content "$PSScriptRoot/../package.json" | ConvertFrom-Json).version
if ($entry[0].DisplayVersion -ne $expectedVersion) { throw 'Installed version did not update.' }
if ($PreviousInstaller -and $priorVersion -eq $expectedVersion) { throw 'Upgrade test requires a different previous version.' }
if ((Get-FileHash $settingsFile).Hash -ne $settingsHash -or (Get-FileHash $draftFile).Hash -ne $draftHash -or (Get-Content $history -Raw).Trim() -ne '{"preserve":true}') { throw 'Upgrade changed settings, draft or review history.' }
Write-Output "PASS: upgrade from $priorVersion to $expectedVersion preserves settings, draft and review history."
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
Remove-Item $settingsFile
Remove-Item $draftFile
Remove-Item $history
Remove-Item $root -Recurse
Write-Output 'PASS: install, shortcuts, registration, uninstall, project data and review history preservation.'

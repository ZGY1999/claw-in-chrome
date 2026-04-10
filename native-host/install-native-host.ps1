param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId,

  [ValidateSet("Chrome", "Edge", "Both")]
  [string]$Browser = "Both"
)

$ErrorActionPreference = "Stop"

$hostDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestTemplatePath = Join-Path $hostDir "com.zgy1999.codex_bridge.json"
$hostCmdPath = Join-Path $hostDir "codex-native-host.cmd"
$manifestOutDir = Join-Path $env:LOCALAPPDATA "CodexBridgeHost"
$manifestOutPath = Join-Path $manifestOutDir "com.zgy1999.codex_bridge.json"

New-Item -ItemType Directory -Force -Path $manifestOutDir | Out-Null

$manifest = Get-Content $manifestTemplatePath -Raw
$manifest = $manifest.Replace("C:\\PATH\\TO\\claw-in-chrome\\native-host\\codex-native-host.cmd", ($hostCmdPath -replace "\\", "\\"))
$manifest = $manifest.Replace("__EXTENSION_ID__", $ExtensionId)

Set-Content -LiteralPath $manifestOutPath -Value $manifest -Encoding UTF8

if ($Browser -in @("Chrome", "Both")) {
  $chromeKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.zgy1999.codex_bridge"
  New-Item -Path $chromeKey -Force | Out-Null
  Set-Item -Path $chromeKey -Value $manifestOutPath
}

if ($Browser -in @("Edge", "Both")) {
  $edgeKey = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.zgy1999.codex_bridge"
  New-Item -Path $edgeKey -Force | Out-Null
  Set-Item -Path $edgeKey -Value $manifestOutPath
}

Write-Host "Installed native host manifest to $manifestOutPath"
Write-Host "Extension ID: $ExtensionId"
Write-Host "Browser target: $Browser"

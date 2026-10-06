# Registers the AuraSynq audio backend to start with Windows (before anyone logs in) and to
# restart if it crashes. Run once from an *administrator* PowerShell:
#   powershell -ExecutionPolicy Bypass -File install-autostart.ps1
# Remove later with:  Unregister-ScheduledTask -TaskName "AuraSynq Companion" -Confirm:$false

param(
    [string]$InstallDir = "C:\AuraSynqCompanion"
)

$script = Join-Path $InstallDir "start-companion.cmd"
if (-not (Test-Path $script)) {
    Write-Error "Missing $script. Copy start-companion.example.cmd there and set the secret first."
    exit 1
}
if (Select-String -Path $script -Pattern "REPLACE_WITH_16_CHARS" -Quiet) {
    Write-Error "Set SERVER_SECRET_KEY in $script first."
    exit 1
}

$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$script`"" -WorkingDirectory $InstallDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName "AuraSynq Companion" -Action $action -Trigger $trigger `
    -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null

Start-ScheduledTask -TaskName "AuraSynq Companion"
Write-Host "Registered and started. Give it about a minute to generate its first PO token, then check:"
Write-Host "  curl.exe http://127.0.0.1:8282/healthz   (expect OK)"
Write-Host "  Get-Content $InstallDir\companion.log -Tail 20   (look for 'Successfully generated PO token')"

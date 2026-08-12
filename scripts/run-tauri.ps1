param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TauriArgs
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$tauriCli = Join-Path $projectRoot 'node_modules\.bin\tauri.cmd'
$viteCli = Join-Path $projectRoot 'node_modules\.bin\vite.cmd'
$devPort = 1420

if (-not (Test-Path -LiteralPath $tauriCli)) {
  throw "Tauri CLI was not found: $tauriCli. Run npm install first."
}

if ($TauriArgs.Count -eq 0 -or $TauriArgs[0] -ne 'dev') {
  & $tauriCli @TauriArgs
  exit $LASTEXITCODE
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $devPort -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($listener) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
  $ownerName = if ($owner) { "$($owner.Name) (PID $($owner.ProcessId))" } else { "PID $($listener.OwningProcess)" }
  throw "Development port $devPort is already used by $ownerName. Stop that process before starting McStartUP so the WebView cannot attach to an unrelated or stale Vite server."
}

if (-not (Test-Path -LiteralPath $viteCli)) {
  throw "Vite CLI was not found: $viteCli. Run npm install first."
}

Write-Host "Starting Vite on http://127.0.0.1:$devPort ..."
$vite = Start-Process -FilePath $viteCli -ArgumentList @('--host', '127.0.0.1', '--port', "$devPort", '--strictPort') -WorkingDirectory $projectRoot -NoNewWindow -PassThru

try {
  $viteReady = $false
  for ($attempt = 0; $attempt -lt 80; $attempt += 1) {
    if ($vite.HasExited) {
      throw "Vite exited before it became ready (exit code $($vite.ExitCode))."
    }
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$devPort/@vite/client" -UseBasicParsing -TimeoutSec 1
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        $viteReady = $true
        break
      }
    } catch {
      # Vite is still initializing; retry below.
    }
    Start-Sleep -Milliseconds 125
  }
  if (-not $viteReady) {
    throw "Vite did not become available on http://127.0.0.1:$devPort within 10 seconds."
  }

  & (Join-Path $PSScriptRoot 'build-shell-extension.ps1') -Profile debug
  if ($LASTEXITCODE -ne 0) {
    throw "Desktop BOX native extensions failed to build with exit code $LASTEXITCODE."
  }

  & $tauriCli @TauriArgs
  exit $LASTEXITCODE
} finally {
  if ($vite -and -not $vite.HasExited) {
    Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue
  }
}

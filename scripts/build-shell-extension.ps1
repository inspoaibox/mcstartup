param(
  [ValidateSet('debug', 'release')]
  [string]$Profile = 'debug'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $projectRoot 'src-tauri\shell-extension\Cargo.toml'
$targetDir = Join-Path $projectRoot 'src-tauri\target'
$profileArgs = @()
if ($Profile -eq 'release') {
  $profileArgs = @('--release')
}

Write-Host "Building McStartUP desktop Box shell extension ($Profile)..."
& cargo build --manifest-path $manifest --target-dir $targetDir @profileArgs
if ($LASTEXITCODE -ne 0) {
  throw "Desktop Box shell extension build failed with exit code $LASTEXITCODE"
}

$builtDll = Join-Path $targetDir "$Profile\mcstartup_desktop_box.dll"
if (-not (Test-Path -LiteralPath $builtDll)) {
  throw "Desktop Box shell extension was not produced: $builtDll"
}

$iconFilterManifest = Join-Path $projectRoot 'src-tauri\desktop-icon-filter\Cargo.toml'
Write-Host "Building McStartUP desktop icon filter ($Profile)..."
& cargo build --manifest-path $iconFilterManifest --target-dir $targetDir @profileArgs
if ($LASTEXITCODE -ne 0) {
  throw "Desktop icon filter build failed with exit code $LASTEXITCODE"
}

$iconFilterDll = Join-Path $targetDir "$Profile\mcstartup_desktop_icon_filter.dll"
if (-not (Test-Path -LiteralPath $iconFilterDll)) {
  throw "Desktop icon filter was not produced: $iconFilterDll"
}

# Keep a stable name in both the executable directory (development) and the
# Tauri resources directory (bundled installs). The DLL itself remains a
# generated artifact and is ignored by git.
$stableExeDll = Join-Path $targetDir "$Profile\McStartUPDesktopBox.dll"
$resourceDll = Join-Path $projectRoot 'src-tauri\resources\McStartUPDesktopBox.bundle.dll'

function Copy-DllWithLockedFallback {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$ProfileName
  )

  try {
    Copy-Item -LiteralPath $Source -Destination $Destination -Force -ErrorAction Stop
    (Get-Item -LiteralPath $Destination).LastWriteTime = Get-Date
    return $Destination
  } catch {
    # Explorer keeps an in-process shell extension loaded for the lifetime of
    # its process. Keep the old DLL alive and publish this build side-by-side
    # so the next McStartUP startup can register the new path.
    $directory = Split-Path -Parent $Destination
    $baseName = [IO.Path]::GetFileNameWithoutExtension($Destination)
    $extension = [IO.Path]::GetExtension($Destination)
    $stamp = Get-Date -Format 'yyyyMMddHHmmssfff'
    $fallback = Join-Path $directory ("{0}.{1}.{2}{3}" -f $baseName, $ProfileName, $stamp, $extension)
    Copy-Item -LiteralPath $Source -Destination $fallback -Force -ErrorAction Stop
    (Get-Item -LiteralPath $fallback).LastWriteTime = Get-Date
    Write-Warning "Destination is locked: $Destination. Published side-by-side DLL: $fallback"
    return $fallback
  }
}

$publishedExeDll = Copy-DllWithLockedFallback -Source $builtDll -Destination $stableExeDll -ProfileName $Profile

# Explorer can keep the bundled resource DLL loaded through dllhost.exe. Use
# the same side-by-side fallback for resources so a locked old copy never
# prevents Tauri from producing an installer. tauri.conf.json includes the
# generated copies and runtime registration selects the newest DLL.
$publishedResourceDll = Copy-DllWithLockedFallback -Source $builtDll -Destination $resourceDll -ProfileName $Profile

$stableIconFilterDll = Join-Path $targetDir "$Profile\McStartUPDesktopIconFilter.dll"
$resourceIconFilterDll = Join-Path $projectRoot 'src-tauri\resources\McStartUPDesktopIconFilter.bundle.dll'
$publishedIconFilterDll = Copy-DllWithLockedFallback -Source $iconFilterDll -Destination $stableIconFilterDll -ProfileName $Profile
$publishedResourceIconFilterDll = Copy-DllWithLockedFallback -Source $iconFilterDll -Destination $resourceIconFilterDll -ProfileName $Profile

Write-Host "Desktop Box shell extension ready: $publishedExeDll"
Write-Host "Bundled desktop Box resource: $publishedResourceDll"
Write-Host "Desktop icon filter ready: $publishedIconFilterDll"
Write-Host "Bundled desktop icon filter resource: $publishedResourceIconFilterDll"

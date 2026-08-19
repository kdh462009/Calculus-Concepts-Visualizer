# Build Calc BC Visualizers for Windows (onedir + zip).
# Run from a Windows machine with Python 3.12+:
#   powershell -ExecutionPolicy Bypass -File scripts\build_windows.ps1
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$DistDir = Join-Path $RootDir "dist"
$AppDir = Join-Path $DistDir "CalcBCVisualizers"
$ZipPath = Join-Path $DistDir "CalcBCVisualizers-windows.zip"

Set-Location $RootDir
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

Write-Host "Installing Python dependencies..."
python -m pip install -r requirements-webapp.txt

Write-Host "Running PyInstaller..."
python -m PyInstaller --noconfirm --clean --distpath $DistDir --workpath (Join-Path $RootDir "build") CalcBCVisualizers.spec

$ExePath = Join-Path $AppDir "CalcBCVisualizers.exe"
if (-not (Test-Path $ExePath)) {
    throw "error: exe not found at $ExePath"
}

Write-Host "Creating zip..."
if (Test-Path $ZipPath) {
    Remove-Item $ZipPath -Force
}
Compress-Archive -Path $AppDir -DestinationPath $ZipPath

Write-Host ""
Write-Host "Build complete:"
Write-Host "  App folder: $AppDir"
Write-Host "  Zip:        $ZipPath"
Write-Host ""
Write-Host "Share the zip. Recipients unzip and run CalcBCVisualizers.exe."
Write-Host "Windows 10/11 needs Microsoft Edge WebView2 Runtime (usually already installed)."

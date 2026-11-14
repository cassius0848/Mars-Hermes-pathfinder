[CmdletBinding()]
param(
    [int]$Port = 8501,
    [switch]$OpenBrowser,
    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

$pythonCommand = Get-Command python -ErrorAction Stop
$venvPython = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    & $pythonCommand.Source -m venv (Join-Path $root ".venv")
}

if (-not $SkipInstall) {
    & $venvPython -m pip install -r (Join-Path $root "requirements.txt")
}

$env:PYTHONPATH = Join-Path $root "src"
& $venvPython (Join-Path $root "scripts\verify_demo_assets.py")
if ($LASTEXITCODE -ne 0) {
    throw "Demo asset verification failed."
}

$url = "http://localhost:$Port"
Write-Host "Mars Pathfinder AI demo: $url"
if ($OpenBrowser) {
    Start-Process $url
}

& $venvPython -m streamlit run (Join-Path $root "app\streamlit_app.py") --server.headless true --server.port $Port

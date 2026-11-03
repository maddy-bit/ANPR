# ==============================================================================
# SIH26127 Traffic Intelligence Platform - Single-Command Demo Shutdown Script
# ==============================================================================
# Gracefully stops:
#   1. FastAPI AI Pipeline (port 8000)
#   2. Spring Boot Backend (port 8080)
#   3. Next.js Frontend (port 3000)
# Cleans up tracked PIDs and listening ports.
# ==============================================================================

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "    SIH26127 TRAFFIC INTELLIGENCE PLATFORM (BEL) - SHUTDOWN CONTROLLER          " -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host ""

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

# 1. Kill tracked processes from PID file
$pidFile = Join-Path $SCRIPT_DIR ".demo_pids.json"
if (Test-Path $pidFile) {
    try {
        $pidsMap = Get-Content $pidFile | ConvertFrom-Json -AsHashtable
        Write-Host "[1/3] Terminating tracked processes from $pidFile..." -ForegroundColor Yellow
        foreach ($name in $pidsMap.Keys) {
            $procId = [int]$pidsMap[$name]
            Write-Host "  -> Stopping $name (PID $procId)..." -ForegroundColor White
            try {
                Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
                # Kill entire process tree in Windows
                taskkill /PID $procId /T /F 2>$null | Out-Null
            } catch {}
        }
    } catch {
        Write-Host "  [WARN] Could not parse PID file." -ForegroundColor DarkYellow
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

# 2. Port-based cleanup check for 8000, 8080, 3000
Write-Host ""
Write-Host "[2/3] Checking remaining port listeners on 8000, 8080, 3000..." -ForegroundColor Yellow
$ports = @(8000, 8080, 3000)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
        $uniquePids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($p in $uniquePids) {
            if ($p -gt 4) { # Avoid system processes
                $pName = (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName
                Write-Host "  -> Terminating listener on port $port (PID $p - $pName)..." -ForegroundColor DarkYellow
                try {
                    taskkill /PID $p /T /F 2>$null | Out-Null
                } catch {}
            }
        }
    } else {
        Write-Host "  [OK] Port $port is free." -ForegroundColor Green
    }
}

# 3. Final verification
Write-Host ""
Write-Host "[3/3] Verifying port releases..." -ForegroundColor Yellow
Start-Sleep -Seconds 1
$stillListening = $false
foreach ($port in $ports) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($c) {
        Write-Host "  [WARN] Port $port is still in use by PID $($c[0].OwningProcess)" -ForegroundColor Red
        $stillListening = $true
    } else {
        Write-Host "  [OK] Port $port is confirmed closed." -ForegroundColor Green
    }
}

Write-Host ""
if (-not $stillListening) {
    Write-Host "================================================================================" -ForegroundColor Green
    Write-Host "       ALL SIH26127 DEMO SERVICES HAVE BEEN SAFELY SHUT DOWN                    " -ForegroundColor Green
    Write-Host "================================================================================" -ForegroundColor Green
} else {
    Write-Host "================================================================================" -ForegroundColor DarkYellow
    Write-Host "  Some processes took longer to terminate. Check Task Manager if necessary.     " -ForegroundColor DarkYellow
    Write-Host "================================================================================" -ForegroundColor DarkYellow
}
Write-Host ""

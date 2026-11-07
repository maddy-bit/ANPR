# ==============================================================================
# SIH26127 Traffic Intelligence Platform - Single-Command Demo Startup Script
# ==============================================================================
# Launches:
#   1. FastAPI AI Pipeline (port 8000)
#   2. Spring Boot Backend (port 8080)
#   3. Next.js Frontend (port 3000)
# Performs prerequisite checks, health polling, and opens the demo in browser.
# ==============================================================================

param (
    [switch]$NoBrowser = $false,
    [int]$TimeoutSeconds = 45
)

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "    SIH26127 TRAFFIC INTELLIGENCE PLATFORM (BEL) - DEMO STARTUP CONTROLLER      " -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host ""

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

# Load .env variables into environment if present
$envFile = Join-Path $SCRIPT_DIR ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#')) {
            $parts = $line.Split('=', 2)
            if ($parts.Length -eq 2) {
                $k = $parts[0].Trim()
                $v = $parts[1].Trim()
                if ($k -and -not [string]::IsNullOrEmpty($v)) {
                    [System.Environment]::SetEnvironmentVariable($k, $v)
                }
            }
        }
    }
}

# --- 1. Dependency & Environment Checks ---
Write-Host "[1/5] Checking environment dependencies..." -ForegroundColor Yellow

# Python Venv check
$PYTHON_EXE = Join-Path $SCRIPT_DIR "ai-service\venv\Scripts\python.exe"
if (-not (Test-Path $PYTHON_EXE)) {
    $systemPython = Get-Command python -ErrorAction SilentlyContinue
    if ($systemPython) {
        $PYTHON_EXE = $systemPython.Source
        Write-Host "  [WARN] ai-service venv not found. Using system Python: $PYTHON_EXE" -ForegroundColor DarkYellow
    } else {
        Write-Host "  [FAIL] Python not found. Please setup ai-service/venv or install Python 3.10+." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  [OK] Python Virtual Environment found ($PYTHON_EXE)" -ForegroundColor Green
}

# Java / JDK check
$JAVA_HOME = $env:JAVA_HOME
if (-not $JAVA_HOME -or -not (Test-Path (Join-Path $JAVA_HOME "bin\java.exe"))) {
    $fallbackJdk = "C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot"
    if (Test-Path $fallbackJdk) {
        $env:JAVA_HOME = $fallbackJdk
        $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
        Write-Host "  [OK] JAVA_HOME set to: $env:JAVA_HOME" -ForegroundColor Green
    } else {
        $systemJava = Get-Command java -ErrorAction SilentlyContinue
        if ($systemJava) {
            Write-Host "  [OK] System Java found: $($systemJava.Source)" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] Java 21 JDK not found. Please set JAVA_HOME." -ForegroundColor Red
            exit 1
        }
    }
} else {
    Write-Host "  [OK] JAVA_HOME is active: $env:JAVA_HOME" -ForegroundColor Green
}

# Maven check
$MAVEN_EXE = "mvn"
$localMvn = Join-Path $SCRIPT_DIR "tools\apache-maven-3.9.6\bin\mvn.cmd"
if (Test-Path $localMvn) {
    $MAVEN_EXE = $localMvn
    $env:PATH = "$((Split-Path $localMvn -Parent));$env:PATH"
    Write-Host "  [OK] Local Maven found ($MAVEN_EXE)" -ForegroundColor Green
} elseif (Get-Command mvn -ErrorAction SilentlyContinue) {
    Write-Host "  [OK] System Maven found" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Maven not found. Please install Maven or include tools/apache-maven." -ForegroundColor Red
    exit 1
}

# Node.js check
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVer = (node -v)
    Write-Host "  [OK] Node.js found ($nodeVer)" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Node.js not found. Please install Node.js 18+." -ForegroundColor Red
    exit 1
}

# --- 2. Port Availability Checks ---
Write-Host ""
Write-Host "[2/5] Checking port status (8000, 8080, 3000)..." -ForegroundColor Yellow

function Test-PortListening($port) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    return ($null -ne $conns)
}

$pidsToTrack = @{}

# Check if services are already responding healthy
$aiAlreadyUp = $false
$backendAlreadyUp = $false
$frontendAlreadyUp = $false

try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8000/health" -TimeoutSec 2 -ErrorAction Stop
    if ($h.status -eq "ok") { $aiAlreadyUp = $true }
} catch {}

try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/health" -TimeoutSec 2 -ErrorAction Stop
    if ($h.status -eq "ok") { $backendAlreadyUp = $true }
} catch {}

try {
    $h = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    if ($h.StatusCode -eq 200) { $frontendAlreadyUp = $true }
} catch {}

# --- 3. Launch Services ---
Write-Host ""
Write-Host "[3/5] Starting application microservices..." -ForegroundColor Yellow

# A. FastAPI AI Engine (Port 8000)
if ($aiAlreadyUp) {
    Write-Host "  -> FastAPI AI Service is already running and healthy on port 8000." -ForegroundColor Cyan
} else {
    Write-Host "  -> Launching FastAPI AI Pipeline on http://127.0.0.1:8000..." -ForegroundColor White
    $aiLogOut = Join-Path $SCRIPT_DIR "data\fastapi_out.log"
    $aiLogErr = Join-Path $SCRIPT_DIR "data\fastapi_err.log"
    $aiProcess = Start-Process -FilePath $PYTHON_EXE -ArgumentList "-m uvicorn main:app --app-dir ai-service --host 127.0.0.1 --port 8000" -WorkingDirectory $SCRIPT_DIR -PassThru -RedirectStandardOutput $aiLogOut -RedirectStandardError $aiLogErr -WindowStyle Hidden
    $pidsToTrack["FastAPI"] = $aiProcess.Id
    Write-Host "     Process PID: $($aiProcess.Id)" -ForegroundColor DarkGray
}

# B. Spring Boot Backend (Port 8080)
if ($backendAlreadyUp) {
    Write-Host "  -> Spring Boot Backend is already running and healthy on port 8080." -ForegroundColor Cyan
} else {
    Write-Host "  -> Launching Spring Boot Backend on http://127.0.0.1:8080..." -ForegroundColor White
    $backendLogOut = Join-Path $SCRIPT_DIR "data\backend_out.log"
    $backendLogErr = Join-Path $SCRIPT_DIR "data\backend_err.log"
    if (-not $env:CACHE_TYPE) { $env:CACHE_TYPE = "none" }
    if (-not $env:AI_SERVICE_URL) { $env:AI_SERVICE_URL = "http://localhost:8000" }
    if (-not $env:INGEST_PASSWORD) { $env:INGEST_PASSWORD = "local-dev-ingest-only-not-for-prod" }
    $mvnArgs = "spring-boot:run -f backend/pom.xml"
    $backendProcess = Start-Process -FilePath $MAVEN_EXE -ArgumentList $mvnArgs -WorkingDirectory $SCRIPT_DIR -PassThru -RedirectStandardOutput $backendLogOut -RedirectStandardError $backendLogErr -WindowStyle Hidden
    $pidsToTrack["SpringBoot"] = $backendProcess.Id
    Write-Host "     Process PID: $($backendProcess.Id)" -ForegroundColor DarkGray
}

# C. Next.js Frontend (Port 3000)
if ($frontendAlreadyUp) {
    Write-Host "  -> Next.js Frontend is already running and healthy on port 3000." -ForegroundColor Cyan
} else {
    Write-Host "  -> Launching Next.js Frontend on http://localhost:3000..." -ForegroundColor White
    $frontendLogOut = Join-Path $SCRIPT_DIR "data\frontend_out.log"
    $frontendLogErr = Join-Path $SCRIPT_DIR "data\frontend_err.log"
    $frontendDir = Join-Path $SCRIPT_DIR "frontend"
    $frontendProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory $frontendDir -PassThru -RedirectStandardOutput $frontendLogOut -RedirectStandardError $frontendLogErr -WindowStyle Hidden
    $pidsToTrack["NextJS"] = $frontendProcess.Id
    Write-Host "     Process PID: $($frontendProcess.Id)" -ForegroundColor DarkGray
}

# Save PIDs to file for STOP_DEMO.ps1
$pidFile = Join-Path $SCRIPT_DIR ".demo_pids.json"
$existingPids = @{}
if (Test-Path $pidFile) {
    try {
        $existingPids = Get-Content $pidFile | ConvertFrom-Json -AsHashtable
    } catch {}
}
foreach ($k in $pidsToTrack.Keys) {
    $existingPids[$k] = $pidsToTrack[$k]
}
$existingPids | ConvertTo-Json | Set-Content $pidFile -Force

# --- 4. Health Check Polling ---
Write-Host ""
Write-Host "[4/5] Polling service health status (timeout: ${TimeoutSeconds}s)..." -ForegroundColor Yellow

function Wait-EndpointHealth($name, $url, $timeout) {
    $elapsed = 0
    Write-Host -NoNewline "  -> Awaiting $name ($url)... "
    while ($elapsed -lt $timeout) {
        try {
            $resp = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
            if ($resp.StatusCode -eq 200) {
                Write-Host "READY ($($elapsed)s)" -ForegroundColor Green
                return $true
            }
        } catch {}
        Start-Sleep -Seconds 2
        $elapsed += 2
        Write-Host -NoNewline "."
    }
    Write-Host "TIMED OUT ($($timeout)s)" -ForegroundColor Red
    return $false
}

$aiOk = Wait-EndpointHealth "FastAPI AI Engine" "http://127.0.0.1:8000/health" $TimeoutSeconds
$bootOk = Wait-EndpointHealth "Spring Boot Backend" "http://127.0.0.1:8080/api/health" $TimeoutSeconds
$frontOk = Wait-EndpointHealth "Next.js Frontend" "http://localhost:3000" $TimeoutSeconds

Write-Host ""
if ($aiOk -and $bootOk -and $frontOk) {
    Write-Host "================================================================================" -ForegroundColor Green
    Write-Host "         ALL SERVICES ARE HEALTHY & OPERATIONAL - PLATFORM IS DEMO-READY        " -ForegroundColor Green
    Write-Host "================================================================================" -ForegroundColor Green
    Write-Host "  • Web Interface:       http://localhost:3000" -ForegroundColor White
    Write-Host "  • Backend REST API:    http://localhost:8080/api/health" -ForegroundColor White
    Write-Host "  • AI Pipeline API:     http://localhost:8000/health" -ForegroundColor White
    Write-Host "  • Stop Script:         .\STOP_DEMO.ps1" -ForegroundColor Yellow
    Write-Host ""

    if (-not $NoBrowser) {
        Write-Host "Opening web dashboard in default browser..." -ForegroundColor Cyan
        Start-Process "http://localhost:3000"
    }
} else {
    Write-Host "================================================================================" -ForegroundColor Red
    Write-Host "  [ERROR] One or more services failed to start within ${TimeoutSeconds} seconds. " -ForegroundColor Red
    Write-Host "================================================================================" -ForegroundColor Red
    if (-not $aiOk)    { Write-Host "  FastAPI Log:       data\fastapi_out.log / data\fastapi_err.log" -ForegroundColor Yellow }
    if (-not $bootOk)  { Write-Host "  Spring Boot Log:   data\backend_out.log / data\backend_err.log" -ForegroundColor Yellow }
    if (-not $frontOk) { Write-Host "  Next.js Log:       data\frontend_out.log / data\frontend_err.log" -ForegroundColor Yellow }
    Write-Host ""
    Write-Host "To shut down any running processes, execute: .\STOP_DEMO.ps1" -ForegroundColor White
    exit 1
}

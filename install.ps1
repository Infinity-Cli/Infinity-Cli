#!/usr/bin/env pwsh
#Requires -Version 5.1
<#
.SYNOPSIS
    One-line installer for Infinity-CLI on Windows.
.DESCRIPTION
    Bootstraps uv, installs a managed Python, creates a virtual environment,
    installs Infinity-CLI in editable mode, and updates the user PATH.
.PARAMETER DryRun
    Print every action that would be performed without modifying the system.
.PARAMETER PythonVersion
    Python version to install via uv (default: 3.12).
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$PythonVersion = "3.12"
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
$Script:ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script:ProjectRoot = (Resolve-Path $Script:ProjectRoot).Path
$Script:InstallRoot = if ($env:INFINITY_CLI_HOME) { $env:INFINITY_CLI_HOME } else { Join-Path $env:LOCALAPPDATA "infinity-cli" }
$Script:BinDir = Join-Path $Script:InstallRoot "bin"
$Script:UvInstallerUrl = "https://github.com/astral-sh/uv/releases/latest/download/uv-installer.ps1"

# ---------------------------------------------------------------------------
# Progress / logging helpers
# ---------------------------------------------------------------------------
function Show-Progress {
    param(
        [Parameter(Mandatory)]
        [string]$Message,
        [int]$Percent = -1
    )
    if ($Percent -ge 0) {
        Write-Progress -Activity "Installing Infinity-CLI" -Status $Message -PercentComplete $Percent
    }
    $timestamp = Get-Date -Format "HH:mm:ss"
    Write-Host "[$timestamp] $Message"
}

function Invoke-DryRunNote {
    param([string]$Action)
    if ($DryRun) {
        Write-Host "    [DRY-RUN] $Action" -ForegroundColor Cyan
    }
}

function Test-IsWindows {
    return ($PSVersionTable.PSVersion.Major -ge 6 -and $IsWindows) -or ($PSVersionTable.PSVersion.Major -lt 6 -and [Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT)
}

function Get-Architecture {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
    switch ($arch) {
        ([System.Runtime.InteropServices.Architecture]::X64) { return "x86_64" }
        ([System.Runtime.InteropServices.Architecture]::Arm64) { return "arm64" }
        default { return $arch.ToString().ToLower() }
    }
}

# ---------------------------------------------------------------------------
# PATH management
# ---------------------------------------------------------------------------
function Update-Path {
    param(
        [Parameter(Mandatory)]
        [string]$Directory
    )

    Show-Progress "Checking user PATH for $Directory"

    if ($DryRun) {
        Invoke-DryRunNote "Would query registry HKCU:\Environment for PATH"
        Invoke-DryRunNote "Would add '$Directory' to user PATH if missing"
        return
    }

    $regPath = "HKCU:\Environment"
    $currentPath = (Get-ItemProperty -Path $regPath -Name "Path" -ErrorAction SilentlyContinue).Path

    if (-not $currentPath) {
        $currentPath = ""
    }

    $paths = $currentPath -split ";" | Where-Object { $_ -ne "" }
    if ($paths -contains $Directory) {
        Show-Progress "Directory already in user PATH"
        return
    }

    $newPath = ($paths + $Directory) -join ";"
    Set-ItemProperty -Path $regPath -Name "Path" -Value $newPath
    Show-Progress "Added $Directory to user PATH"

    # Broadcast environment change so new consoles pick it up.
    $HWND_BROADCAST = [IntPtr]0xFFFF
    $WM_SETTINGCHANGE = 0x1A
    $signature = @"
using System;
using System.Runtime.InteropServices;
public class EnvChange {
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern bool SendNotifyMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);
}
"@
    Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue | Out-Null
    [EnvChange]::SendNotifyMessage($HWND_BROADCAST, $WM_SETTINGCHANGE, [IntPtr]::Zero, "Environment") | Out-Null
}

# ---------------------------------------------------------------------------
# uv bootstrap
# ---------------------------------------------------------------------------
function Install-Uv {
    Show-Progress "Bootstrapping uv from $Script:UvInstallerUrl"

    if ($DryRun) {
        Invoke-DryRunNote "Would download uv installer from: $Script:UvInstallerUrl"
        Invoke-DryRunNote "Would invoke installer targeting install root: $Script:InstallRoot"
        return
    }

    $installerPath = Join-Path $env:TEMP "uv-installer.ps1"
    Invoke-WebRequest -Uri $Script:UvInstallerUrl -OutFile $installerPath -UseBasicParsing
    & "$installerPath" -NoModifyPath
    if ($LASTEXITCODE -ne 0) { throw "uv installer failed with exit code $LASTEXITCODE" }
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
    Show-Progress "uv installed"
}

# ---------------------------------------------------------------------------
# Managed Python
# ---------------------------------------------------------------------------
function Install-Python {
    Show-Progress "Installing managed Python $PythonVersion via uv"

    $uvExe = "uv"
    try {
        $uvPath = (Get-Command uv -ErrorAction Stop).Source
        $uvExe = $uvPath
    } catch {
        # uv may not be on PATH yet; fall back to the one in the install tree.
        $candidate = Join-Path $Script:InstallRoot "uv.exe"
        if (Test-Path $candidate) { $uvExe = $candidate }
    }

    if ($DryRun) {
        Invoke-DryRunNote "Would run: $uvExe python install $PythonVersion"
        return
    }

    & $uvExe python install $PythonVersion
    if ($LASTEXITCODE -ne 0) { throw "Failed to install Python $PythonVersion" }
    Show-Progress "Python $PythonVersion installed"
}

# ---------------------------------------------------------------------------
# Infinity-CLI installation
# ---------------------------------------------------------------------------
function Install-InfinityCli {
    Show-Progress "Creating virtual environment and installing Infinity-CLI"

    $venvPath = Join-Path $Script:InstallRoot "venv"
    $uvExe = "uv"
    try {
        $uvPath = (Get-Command uv -ErrorAction Stop).Source
        $uvExe = $uvPath
    } catch {
        $candidate = Join-Path $Script:InstallRoot "uv.exe"
        if (Test-Path $candidate) { $uvExe = $candidate }
    }

    if ($DryRun) {
        Invoke-DryRunNote "Would create venv at: $venvPath"
        Invoke-DryRunNote "Would run: $uvExe venv '$venvPath' --python $PythonVersion"
        Invoke-DryRunNote "Would run: $uvExe pip install -e '$Script:ProjectRoot'"
        Invoke-DryRunNote "Would create wrapper scripts in: $Script:BinDir"
        return
    }

    if (-not (Test-Path $Script:InstallRoot)) {
        New-Item -ItemType Directory -Path $Script:InstallRoot -Force | Out-Null
    }
    if (-not (Test-Path $Script:BinDir)) {
        New-Item -ItemType Directory -Path $Script:BinDir -Force | Out-Null
    }

    & $uvExe venv "$venvPath" --python $PythonVersion
    if ($LASTEXITCODE -ne 0) { throw "Failed to create virtual environment" }

    & $uvExe pip install -e "$Script:ProjectRoot"
    if ($LASTEXITCODE -ne 0) { throw "Failed to install Infinity-CLI" }

    # Create small wrapper scripts in bin dir.
    $infinityExe = Join-Path $venvPath "Scripts\infinity.exe"
    $wrapperPs1 = Join-Path $Script:BinDir "infinity.ps1"
    $wrapperCmd = Join-Path $Script:BinDir "infinity.cmd"

    "& `"$infinityExe`" @args" | Set-Content -Path $wrapperPs1 -Encoding UTF8
    "@echo off`n`"$infinityExe`" %*" | Set-Content -Path $wrapperCmd -Encoding ASCII

    Show-Progress "Infinity-CLI installed"
}

# ---------------------------------------------------------------------------
# Node.js check
# ---------------------------------------------------------------------------
function Test-NodeJs {
    Show-Progress "Checking Node.js availability"
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Warning "Node.js was not found on PATH. Infinity-CLI requires Node.js >= 18 for the daemon. Please install Node.js manually."
        return
    }

    $versionString = (& node --version) -replace "v", ""
    $major = [int]($versionString -split "\.")[0]
    if ($major -lt 18) {
        Write-Warning "Node.js v$versionString is installed, but Infinity-CLI requires Node.js >= 18. Please upgrade Node.js manually."
    } else {
        Show-Progress "Node.js v$versionString is available"
    }
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
function Install-InfinityCliFull {
    Show-Progress "Starting Infinity-CLI installation"
    Show-Progress "Detected OS: Windows, Architecture: $(Get-Architecture)"
    Show-Progress "Install root: $Script:InstallRoot"

    if (-not (Test-IsWindows)) {
        Write-Warning "This installer is designed for Windows. Running on another OS will only succeed in dry-run mode."
        if (-not $DryRun) {
            throw "Aborting: non-Windows OS detected."
        }
    }

    Install-Uv
    Show-Progress -Message "uv bootstrap complete" -Percent 30

    Install-Python
    Show-Progress -Message "Python installation complete" -Percent 60

    Install-InfinityCli
    Show-Progress -Message "Infinity-CLI package installation complete" -Percent 85

    Update-Path -Directory $Script:BinDir
    Test-NodeJs

    Show-Progress -Message "Installation complete" -Percent 100
    if ($DryRun) {
        Show-Progress "Dry run finished. No changes were made."
    } else {
        Show-Progress "You may need to open a new terminal for PATH changes to take effect."
        Show-Progress "Run 'infinity' to get started."
    }
}

# Run main
try {
    Install-InfinityCliFull
} catch {
    Write-Error "Installation failed: $_"
    exit 1
}
exit 0

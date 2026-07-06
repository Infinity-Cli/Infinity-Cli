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
$Script:ReleaseVersion = "v0.1.12"
$Script:SourceArchiveUrl = "https://github.com/Infinity-Cli/Infinity-Cli/archive/refs/tags/$Script:ReleaseVersion.zip"
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
    # Windows PowerShell 5.1 runs on .NET Framework, where RuntimeInformation
    # is not guaranteed to be loaded. Prefer the PROCESSOR_ARCHITECTURE env var.
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        $arch = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
        switch ($arch) {
            ([System.Runtime.InteropServices.Architecture]::X64) { return "x86_64" }
            ([System.Runtime.InteropServices.Architecture]::Arm64) { return "arm64" }
            default { return $arch.ToString().ToLower() }
        }
    }

    $arch = [Environment]::GetEnvironmentVariable("PROCESSOR_ARCHITECTURE")
    switch ($arch) {
        "AMD64" { return "x86_64" }
        "ARM64" { return "arm64" }
        default { return $arch.ToLower() }
    }
}

# ---------------------------------------------------------------------------
# PATH management
# ---------------------------------------------------------------------------
function Remove-OldInfinityWrapper {
    $oldPaths = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\Scripts\infinity.exe")
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\Scripts\infinity.exe")
        (Join-Path $env:ProgramFiles "Python311\Scripts\infinity.exe")
        (Join-Path $env:ProgramFiles "Python312\Scripts\infinity.exe")
    )
    foreach ($old in $oldPaths) {
        if (Test-Path $old) {
            if ($DryRun) {
                Invoke-DryRunNote "Would remove old infinity wrapper: $old"
            } else {
                Show-Progress "Removing old infinity wrapper: $old"
                Remove-Item $old -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Update-Path {
    param(
        [Parameter(Mandatory)]
        [string]$Directory
    )

    Show-Progress "Checking user PATH for $Directory"

    if ($DryRun) {
        Invoke-DryRunNote "Would query registry HKCU:\Environment for PATH"
        Invoke-DryRunNote "Would prepend '$Directory' to user PATH if missing"
        return
    }

    $regPath = "HKCU:\Environment"
    $currentPath = (Get-ItemProperty -Path $regPath -Name "Path" -ErrorAction SilentlyContinue).Path

    if (-not $currentPath) {
        $currentPath = ""
    }

    $paths = $currentPath -split ";" | Where-Object { $_ -ne "" }
    if ($paths -and $paths[0] -eq $Directory) {
        Show-Progress "Directory already at front of user PATH"
        return
    }

    # Remove existing occurrence and prepend so the new wrapper wins over any
    # stale global installation (e.g., an old Python Scripts\infinity.exe).
    $filtered = $paths | Where-Object { $_ -ne $Directory }
    $newPath = $Directory
    if ($filtered) {
        $newPath = "$Directory;" + ($filtered -join ";")
    }
    Set-ItemProperty -Path $regPath -Name "Path" -Value $newPath
    Show-Progress "Prepended $Directory to user PATH"

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
    $exitCode = $LASTEXITCODE

    # The uv installer may report success on stdout/stderr but still exit 1
    # (e.g., PATH modification skipped). Accept a non-zero exit code as long
    # as uv.exe ended up in one of the expected locations.
    $uvCandidates = @(
        (Get-Command uv -ErrorAction SilentlyContinue).Source
        (Join-Path $env:USERPROFILE ".local\bin\uv.exe")
        (Join-Path $env:LOCALAPPDATA "Programs\uv\uv.exe")
        (Join-Path $Script:InstallRoot "uv.exe")
    )
    $uvFound = $false
    foreach ($candidate in $uvCandidates) {
        if ($candidate -and (Test-Path $candidate)) {
            $uvFound = $true
            # Make sure the current session can find uv for the rest of the install.
            $candidateDir = Split-Path -Parent $candidate
            if (-not ($env:Path -split ";" | Where-Object { $_ -eq $candidateDir })) {
                $env:Path = "$candidateDir;$env:Path"
            }
            break
        }
    }

    if ($exitCode -and $exitCode -ne 0 -and -not $uvFound) {
        throw "uv installer failed with exit code $exitCode"
    }

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
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Failed to install Python $PythonVersion" }
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
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Failed to create virtual environment" }

    # uv pip install detects the active environment via VIRTUAL_ENV or by finding
    # .venv/venv in the current directory. Explicitly activate the new venv so the
    # subsequent install command targets it.
    $env:VIRTUAL_ENV = $venvPath
    $venvScripts = Join-Path $venvPath "Scripts"
    if (-not ($env:Path -split ";" | Where-Object { $_ -eq $venvScripts })) {
        $env:Path = "$venvScripts;$env:Path"
    }

    & $uvExe pip install -e "$Script:ProjectRoot"
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Failed to install Infinity-CLI" }

    Show-Progress "Infinity-CLI Python backend installed"
}

# ---------------------------------------------------------------------------
# TypeScript CLI front-end
# ---------------------------------------------------------------------------
function Build-TypeScriptCli {
    Show-Progress "Building TypeScript CLI front-end"

    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js is required to build the Infinity CLI front-end but was not found on PATH."
    }

    $cliDir = Join-Path $Script:ProjectRoot "cli-ts"

    if ($DryRun) {
        Invoke-DryRunNote "Would run: npm install in $cliDir"
        Invoke-DryRunNote "Would run: npm run build in $cliDir"
        return
    }

    if (-not (Test-Path $cliDir)) {
        throw "TypeScript CLI source not found at $cliDir"
    }

    Show-Progress "Installing Node dependencies for TypeScript CLI"
    Push-Location $cliDir
    try {
        & npm install
        if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }

        Show-Progress "Building TypeScript CLI"
        & npm run build
        if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    $distPath = Join-Path $cliDir "dist\index.js"
    if (-not (Test-Path $distPath)) {
        throw "TypeScript CLI build did not produce $distPath"
    }

    Show-Progress "TypeScript CLI built"
}

function Install-Wrappers {
    Show-Progress "Creating Infinity CLI wrapper scripts"

    $nodePath = (Get-Command node -ErrorAction Stop).Source
    $distPath = Join-Path $Script:ProjectRoot "cli-ts\dist\index.js"

    if ($DryRun) {
        Invoke-DryRunNote "Would create wrapper scripts in $Script:BinDir pointing to:"
        Invoke-DryRunNote "  node: $nodePath"
        Invoke-DryRunNote "  dist: $distPath"
        return
    }

    if (-not (Test-Path $Script:BinDir)) {
        New-Item -ItemType Directory -Path $Script:BinDir -Force | Out-Null
    }

    $wrapperPs1 = Join-Path $Script:BinDir "infinity.ps1"
    $wrapperCmd = Join-Path $Script:BinDir "infinity.cmd"

    "& `"$nodePath`" `"$distPath`" @args" | Set-Content -Path $wrapperPs1 -Encoding UTF8
    "@echo off`n`"$nodePath`" `"$distPath`" %*" | Set-Content -Path $wrapperCmd -Encoding ASCII

    Show-Progress "Wrapper scripts created"
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
# Project root resolution (supports local execution and irm ... | iex)
# ---------------------------------------------------------------------------
function Initialize-ProjectRoot {
	$scriptPath = $MyInvocation.MyCommand.Path
	if ($scriptPath -and (Test-Path $scriptPath)) {
		$localRoot = Split-Path -Parent $scriptPath
		if (Test-Path (Join-Path $localRoot "pyproject.toml")) {
			return (Resolve-Path $localRoot).Path
		}
	}

	$downloadDir = Join-Path $env:TEMP "infinity-cli-$Script:ReleaseVersion"
	$archivePath = "$downloadDir.zip"
	$extractedDir = Join-Path $downloadDir "Infinity-Cli-$($Script:ReleaseVersion.Substring(1))"

	if (Test-Path $extractedDir) {
		return (Resolve-Path $extractedDir).Path
	}

	Show-Progress "Downloading Infinity-CLI $Script:ReleaseVersion source archive"
	if ($DryRun) {
		Invoke-DryRunNote "Would download source archive from: $Script:SourceArchiveUrl"
		Invoke-DryRunNote "Would extract to: $downloadDir"
		return $downloadDir
	}

	if (-not (Test-Path $downloadDir)) {
		New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
	}
	Invoke-WebRequest -Uri $Script:SourceArchiveUrl -OutFile $archivePath -UseBasicParsing
	Expand-Archive -Path $archivePath -DestinationPath $downloadDir -Force
	Remove-Item $archivePath -Force -ErrorAction SilentlyContinue
	if (-not (Test-Path $extractedDir)) {
		throw "Source archive did not extract to expected directory: $extractedDir"
	}
	return (Resolve-Path $extractedDir).Path
}

$Script:ProjectRoot = Initialize-ProjectRoot

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
    Show-Progress -Message "Infinity-CLI package installation complete" -Percent 70

    Build-TypeScriptCli
    Show-Progress -Message "TypeScript CLI front-end built" -Percent 80

    Install-Wrappers
    Show-Progress -Message "Infinity CLI wrapper created" -Percent 90

    Remove-OldInfinityWrapper
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

$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$home2 = Join-Path $env:LOCALAPPDATA "ZapCut"
New-Item -ItemType Directory -Force -Path $home2 | Out-Null
$venv = Join-Path $home2 "venv"
$vpy = Join-Path $venv "Scripts\python.exe"
$ready = Join-Path $home2 ".ready_v3"
foreach ($n in 9..12) { try { New-Item -Path "HKCU:\Software\Adobe\CSXS.$n" -Force | Out-Null; New-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.$n" -Name PlayerDebugMode -Value "1" -PropertyType String -Force | Out-Null } catch {} }
if ((Test-Path $vpy) -and (Test-Path $ready)) { exit 0 }
if (-not (Test-Path $vpy)) {
  $py = $null
  foreach ($c in @("py -3.11","py -3.12","py -3.10","python")) {
    try { $v = & cmd /c "$c --version 2>&1"; if ($v -match "Python 3\.(1[0-2])") { $py = $c; break } } catch {}
  }
  if (-not $py) {
    $inst = Join-Path $env:TEMP "python-installer.exe"
    Invoke-WebRequest "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe" -OutFile $inst
    Start-Process $inst -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1" -Wait
    $py = "`"" + (Join-Path $env:LOCALAPPDATA "Programs\Python\Python311\python.exe") + "`""
  }
  & cmd /c "$py -m venv `"$venv`""
}
& $vpy -m pip install --upgrade pip
& $vpy -m pip install --upgrade faster-whisper "mediapipe==0.10.14" av numpy pillow
try {
  if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
    & $vpy -m pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
  }
} catch {}
try { & $vpy -c "from faster_whisper import download_model; download_model('small')" } catch {}
New-Item -ItemType File -Path $ready -Force | Out-Null
exit 0

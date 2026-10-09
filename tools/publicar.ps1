# Publica una versión nueva de ZapCut para el actualizador automático.
# Uso:  powershell -ExecutionPolicy Bypass -File tools\publicar.ps1 -Pfx C:\ruta\zapcut_updates.pfx -Notas "Qué cambió"
# 1) Sube el número de versión en src\ext\CSXS\manifest.xml (ExtensionBundleVersion y Version de la extensión).
# 2) Ejecuta este script. Crea dist\ZapCut_vX_extension.zip y dist\version.json firmado.
# 3) Sube los cambios con git (add, commit, push).
param(
  [Parameter(Mandatory=$true)][string]$Pfx,
  [string]$Notas = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$ext  = Join-Path $root "src\ext"
$manifest = Get-Content (Join-Path $ext "CSXS\manifest.xml") -Raw
$ver = [regex]::Match($manifest, 'ExtensionBundleVersion="([\d.]+)"').Groups[1].Value
if (-not $ver) { throw "No encontré la versión en manifest.xml" }
$pw = Read-Host "Contraseña de la llave de actualizaciones" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($Pfx, $plain)
$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
$zip = Join-Path $root "dist\ZapCut_v${ver}_extension.zip"
if (Test-Path $zip) { Remove-Item $zip }
$tmp = Join-Path $env:TEMP ("zapcut_pub_" + [guid]::NewGuid().ToString("N"))
Copy-Item $ext $tmp -Recurse
Get-ChildItem $tmp -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force
Get-ChildItem $tmp -Recurse -Directory -Filter "venv" | Remove-Item -Recurse -Force
Compress-Archive -Path "$tmp\*" -DestinationPath $zip -Force
Remove-Item $tmp -Recurse -Force
$sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
$bytes = [Text.Encoding]::UTF8.GetBytes("$ver|$sha")
$sig = [Convert]::ToBase64String($rsa.SignData($bytes, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1))
$obj = [ordered]@{ version = $ver; zip = "https://raw.githubusercontent.com/SoyYeral/zapcut/main/dist/ZapCut_v${ver}_extension.zip"; sha256 = $sha; sig = $sig; notes = $Notas }
$obj | ConvertTo-Json | Set-Content (Join-Path $root "dist\version.json") -Encoding UTF8
Write-Host "Listo: versión $ver. Ahora ejecuta:  git add -A ; git commit -m 'v$ver' ; git push"

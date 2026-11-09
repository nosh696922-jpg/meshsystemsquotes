# Builds MeshQuotes.exe, the Windows program, and copies it to
# public\download\ so the website can offer it.
#
#   powershell -ExecutionPolicy Bypass -File desktop\build.ps1
#
# Needs only Windows: it uses the C# compiler that comes with .NET Framework.
# The first run downloads Microsoft's WebView2 kit from nuget.org and checks
# it against the fingerprint below.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$sdkVersion = '1.0.4129.50'
$sdkSha512 = '9TM9AZpDUiAb6OJB9s6thxl63BJFgbINcp047Zy+oiz9+cjgLhFrMRZ5Be+5wVHGvMJR3z1rmPWeJipo4g0sJw=='

$work = Join-Path $here '.build'
$sdk = Join-Path $work "webview2-$sdkVersion"
$package = Join-Path $work "webview2-$sdkVersion.nupkg"
New-Item -ItemType Directory -Force $work | Out-Null

if (-not (Test-Path (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
  if (-not (Test-Path $package)) {
    Write-Host "Downloading WebView2 kit $sdkVersion from nuget.org..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $url = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$sdkVersion/microsoft.web.webview2.$sdkVersion.nupkg"
    Invoke-WebRequest $url -OutFile $package -UseBasicParsing
  }
  $sha = [System.Security.Cryptography.SHA512]::Create()
  $stream = [System.IO.File]::OpenRead($package)
  $actual = [Convert]::ToBase64String($sha.ComputeHash($stream))
  $stream.Dispose()
  if ($actual -ne $sdkSha512) {
    Remove-Item $package
    throw "The downloaded WebView2 kit doesn't match its fingerprint, so it wasn't used. Try again."
  }
  $zip = Join-Path $work 'webview2.zip'
  Copy-Item $package $zip -Force
  Expand-Archive $zip $sdk -Force
  Remove-Item $zip
}

$lib = Join-Path $sdk 'lib\net462'
$core = Join-Path $lib 'Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $lib 'Microsoft.Web.WebView2.WinForms.dll'
$loader = Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "Couldn't find the C# compiler at $csc (it comes with .NET Framework 4)." }

$dist = Join-Path $here 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$exe = Join-Path $dist 'MeshQuotes.exe'

Write-Host 'Compiling MeshQuotes.exe...'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /utf8output `
  "/out:$exe" `
  "/win32icon:$(Join-Path $here 'mesh.ico')" `
  "/win32manifest:$(Join-Path $here 'app.manifest')" `
  /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
  "/reference:$core" "/reference:$forms" `
  "/resource:$core,Microsoft.Web.WebView2.Core.dll" `
  "/resource:$forms,Microsoft.Web.WebView2.WinForms.dll" `
  "/resource:$loader,WebView2Loader.dll" `
  "/resource:$(Join-Path $here 'mesh.ico'),mesh.ico" `
  "/resource:$(Join-Path $here 'THIRD-PARTY-NOTICES.txt'),THIRD-PARTY-NOTICES.txt" `
  (Join-Path $here 'MeshQuotes.cs')
if ($LASTEXITCODE -ne 0) { throw 'The C# compiler reported errors (see above).' }

$download = Join-Path (Split-Path -Parent $here) 'public\download'
New-Item -ItemType Directory -Force $download | Out-Null
Copy-Item $exe (Join-Path $download 'MeshQuotes.exe') -Force
$size = [Math]::Round((Get-Item $exe).Length / 1KB)
Write-Host "Built $exe ($size KB) and copied it to public\download\MeshQuotes.exe"

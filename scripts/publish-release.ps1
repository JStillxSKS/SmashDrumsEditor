param(
  [string]$Tag = "v0.1.0",
  [string]$ExePath = "$PSScriptRoot\..\release\Smash-Drums-Editor-0.1.0-portable.exe"
)

$ErrorActionPreference = "Stop"

$credInput = "protocol=https`nhost=github.com`n"
$credOutput = $credInput | & "C:\Program Files\Git\bin\git.exe" credential fill 2>$null
$token = ($credOutput | Select-String '^password=').ToString().Substring(9)
$env:GH_TOKEN = $token

$gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) {
  throw "GitHub CLI not found at $gh"
}
if (-not (Test-Path $ExePath)) {
  throw "Portable EXE not found: $ExePath"
}

$notes = @"
## Smash Drums Editor v0.1.0

Desktop chart editor for Smash Drums custom songs.

### Download
Run **Smash-Drums-Editor-0.1.0-portable.exe** — no install required (Windows x64).

### Features
- Visual highway editor with waveform overview
- Six lanes, four difficulties, crystal/neutral/burning note strengths
- Import .indies, meta.json, or Clone Hero .chart
- Export .indies or Clone Hero chart + song.ini

### From source

git clone https://github.com/JStillxSKS/SmashDrumsEditor.git
cd SmashDrumsEditor
npm install
npm run desktop:dev
"@

& $gh release create $Tag $ExePath `
  --repo JStillxSKS/SmashDrumsEditor `
  --title "Smash Drums Editor v0.1.0" `
  --notes $notes

Write-Host "Release published for $Tag"
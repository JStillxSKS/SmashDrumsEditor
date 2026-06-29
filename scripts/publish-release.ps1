param(
  [string]$Tag = "v0.1.1",
  [string]$ExePath = "$PSScriptRoot\..\release\Smash-Drums-Editor-0.1.1-portable.exe"
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
## Smash Drums Editor v0.1.1

Desktop chart editor for Smash Drums custom songs.

### Download
Run **Smash-Drums-Editor-0.1.1-portable.exe** — no install required (Windows x64).

### What's new since v0.1.0
- Copy mode: press **C**, drag a box to select notes, auto-scroll at highway edges
- Paste lands the first copied note exactly on the strike bar
- Desktop exports save to **Desktop/Smash Drums Editor/output/**
- Cannot place notes behind the strike bar; **Ctrl+C** only copies notes at or ahead of the bar
- Copy box mode can still copy notes anywhere in the selection
- Fixed .indies export hang and improved export feedback

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
  --title "Smash Drums Editor v0.1.1" `
  --notes $notes

Write-Host "Release published for $Tag"
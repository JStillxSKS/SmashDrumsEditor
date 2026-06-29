param(
  [string]$Tag = "v0.1.2",
  [string]$ExePath = "$PSScriptRoot\..\release\Smash-Drums-Editor-0.1.2-portable.exe"
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
## Smash Drums Editor v0.1.2

Desktop chart editor for Smash Drums custom songs.

### Download
Run **Smash-Drums-Editor-0.1.2-portable.exe** — no install required (Windows x64).

### Critical fix
- **Exports no longer save to Windows Temp** (portable EXE used to write next to a temp extract folder — files could vanish when temp was cleared)
- Exports always go to **Desktop/Smash Drums Editor/output/**
- After export, the output folder opens automatically and shows the full save path

### What's new since v0.1.0
- Copy mode, paste-at-strike, strike-bar placement rules
- Fixed .indies export hang

### From source

git clone https://github.com/JStillxSKS/SmashDrumsEditor.git
cd SmashDrumsEditor
npm install
npm run desktop:dev
"@

& $gh release create $Tag $ExePath `
  --repo JStillxSKS/SmashDrumsEditor `
  --title "Smash Drums Editor v0.1.2" `
  --notes $notes

Write-Host "Release published for $Tag"
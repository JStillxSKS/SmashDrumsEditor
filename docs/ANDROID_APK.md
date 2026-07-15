# Smash Drums Editor — Android APK

For people **without a PC**: install the **`.apk` only**. One file, tap to install.

## One-click download (what players want)

**APK only (install this):**  
https://github.com/JStillxSKS/SmashDrumsEditor/releases/download/v0.1.3/Smash-Drums-Editor-0.1.3.apk  

**Release page (Assets button):**  
https://github.com/JStillxSKS/SmashDrumsEditor/releases/tag/v0.1.3  

Share the **.apk** link (or the Releases page). Players do **not** need the full project zip.

| File | Who | What |
|------|-----|------|
| **`Smash-Drums-Editor-*.apk`** | Everyone | **Only file they need** — install and open |
| Full source / project zip | Devs | Optional; not for players |

## Install (phone / tablet) — simple

1. Open the **APK download link** above (or tap the APK under **Assets** on the release page).
2. Open the downloaded file on the phone.
3. If Android asks: allow **Install unknown apps** for Chrome / Files / Discord.
4. Tap **Install** → **Open**.
5. First open: choose Portrait or Landscape when prompted.
6. Tap **Play** once so audio is allowed.

Exported charts (`.indies`) go to the phone’s **Downloads** (or the system download folder).

## Quest / headset

Same APK can be sideloaded with **SideQuest** or `adb install Smash-Drums-Editor-*.apk`.  
UI is built for phone/tablet first; headset works as a large Android screen.

## Build the APK (developers)

**Requirements:** Node.js, JDK **21**, Android SDK (`ANDROID_HOME`).

```bash
cd SmashDrumsEditor
npm install
npm run android:apk
node scripts/copy-android-apk.cjs
```

Outputs:

- `android/app/build/outputs/apk/debug/app-debug.apk` (raw Gradle name)
- `release/apk/Smash-Drums-Editor-<version>.apk` (friendly name after copy script)

Sync only (after web changes):

```bash
npm run android:sync
```

Open Android Studio:

```bash
npm run android:open
```

## Notes

- This is a **debug** APK (easy sideload). Play Store / signed release can come later.
- Desktop Windows portable EXE is unchanged: `npm run desktop:build`.
- App id: `com.smashdrums.editor`

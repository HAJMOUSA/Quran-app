---
name: mobile-dev-setup
description: Use when building, running, installing, or debugging the quran-app Expo mobile app (mobile/) on iOS or Android from this Windows no-Mac machine — covers dev servers, EAS cloud builds, physical-device install, Developer Mode, and the WSL/bun toolchain quirks.
---

# quran-app Mobile Dev Setup (iOS + Android)

## Overview

The `mobile/` app is an Expo Router app (SDK 58, React Native 0.88, new architecture). It ships a native module (`whisper.rn`) plus `expo-audio`, so it is **NOT Expo-Go-compatible for the native features** — real device features need a dev-client or standalone build. This machine has **no Mac**, so iOS is built in the **cloud via EAS**.

Bundle id / package (both platforms): `com.ahajmousa.quranapp`. EAS account: `ahajmousa` (hajmousa@gmail.com). Apple team: **Ayman Hajmousa (Individual)** `R3V63T48HF`. EAS project: `@ahajmousa/mobile` (projectId in [app.json](../../../mobile/app.json)).

## The toolchain, and why it's weird

| Task | Tool | Where it runs |
|------|------|---------------|
| Install deps / run Metro | **bun** (`bunx`, `bun install`) | **Windows** PowerShell |
| EAS cloud builds / device mgmt | **eas-cli** | **WSL Ubuntu** (clean Linux node) |
| Drive Android device | **adb** | Windows |

**Never use `npm` on Windows** — it's broken (`Class extends value undefined`: an nvm-v20 npm tree running under node v24). Use `bun` (or `pnpm`). See [[mobile-dev-environment]].

**eas-cli does NOT work on the Windows side** (Windows npm crashes; `bun add -g`/`bunx` fail to extract tarballs). eas-cli is installed under **WSL Ubuntu** only, at `/home/hajmousa/.nvm/versions/node/v26.13.0/bin/eas`. See [[ios-eas-build-setup]].

### Calling eas-cli non-interactively (read-only checks)

Run via the **PowerShell tool** (NOT Git-Bash — MSYS mangles the paths), with a hardcoded clean PATH:

```powershell
wsl -d Ubuntu -- bash -c 'export PATH=/home/hajmousa/.nvm/versions/node/v26.13.0/bin:/usr/bin:/bin; cd /mnt/c/Repo/quran-app/mobile; eas <cmd>'
```

Traps: (a) do **not** reference `$PATH` when building PATH — WSL interop leaks the Windows PATH which has spaces and `(x86)` → `syntax error near '('`; hardcode `/usr/bin:/bin`. (b) the `. $NVM_DIR/nvm.sh` trick fails from Git-Bash (empty `$NVM_DIR` → `/nvm.sh: No such file`). Safe read-only cmds: `whoami`, `build:list --platform ios`, `device:list --apple-team-id R3V63T48HF`.

**Interactive commands (`login`, `init`, `device:create`, iOS `build`, `submit`) must be run by the user in their own interactive Ubuntu/WSL terminal** — the agent can't drive the Expo/Apple prompts. In an interactive shell nvm auto-loads from `.bashrc`, so `eas` resolves directly (no PATH juggling).

**Exception — the agent CAN run Android builds and OTA updates non-interactively** (no Apple/credentials prompts to drive): `eas build -p android --profile preview --non-interactive` and `eas update ... --non-interactive` work straight from the PowerShell-tool `wsl` wrapper above. The Android keystore is auto-generated **in the cloud** on the first build (because `keytool` isn't installed locally, EAS skips the local prompt). See the release/OTA sections below.

## Android — run on the physical device

Daily JS loop uses **Expo Go** (fast iterate). Native `whisper.rn` features require a release build (see [[offline-whisper-model-findings]]).

Physical device: Samsung Galaxy S24 Ultra, adb id `R5CX327XC5L`, kept in **airplane mode** (so its LAN IP is unreachable — must force localhost over USB).

```powershell
cd C:\Repo\quran-app\mobile
adb -s R5CX327XC5L reverse tcp:8081 tcp:8081   # Metro
adb -s R5CX327XC5L reverse tcp:8000 tcp:8000   # API server (if used)
bunx expo start --clear                        # binds 0.0.0.0:8081 (IPv4) — do NOT use --localhost
adb -s R5CX327XC5L shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
```

- **Do NOT use `--localhost`** — it binds IPv6 `[::1]` only, but adb reverse forwards IPv4 `127.0.0.1`; mismatch → Expo Go "Something went wrong". Verify host with `netstat -ano | findstr :8081` (want `0.0.0.0`).
- Clean reload: `adb -s R5CX327XC5L shell am force-stop host.exp.exponent` then re-push the deep link (bare re-push shows a stale render).
- Navigate by deep link (tab taps unreliable): `exp://127.0.0.1:8081/--/browse`, `/--/search`, `/--/settings`.
- Screenshot: `adb -s R5CX327XC5L exec-out screencap -p > out.png`.
- Device may be **locked** (secure PIN) — a deep link then shows a black/PIN screen and Metro logs no bundle request. The agent can't enter the PIN; ask the user to unlock. Check with `adb -s R5CX327XC5L shell dumpsys window | findstr mDreamingLockscreen` (`=true` means locked).

## Android — release APK → Google Drive (distribution channel)

The chosen distribution channel for testers is a **release APK uploaded to Google Drive** (no Google Play — user won't pay the $25 for internal testing). The `preview` profile in [eas.json](../../../mobile/eas.json) already emits an APK (`buildType: apk`, internal).

**One command (run from WSL Ubuntu):**
```bash
bash mobile/scripts/release-android-drive.sh
```
It builds the APK on EAS, extracts the artifact URL, uploads to `gdrive:quran-app-apks/quran-app-v<version>-<timestamp>.apk`, and prints a share link. The agent can run this whole flow non-interactively via the PowerShell `wsl` wrapper.

Under the hood:
- **Build:** `eas build -p android --profile preview --non-interactive --json` → the APK URL is the `applicationArchiveUrl` field (same as `buildUrl`). First build auto-creates the cloud keystore + remote Android credentials under `@ahajmousa/mobile`.
- **Google Drive = rclone.** rclone is installed on **Windows** (winget `Rclone.Rclone`) at `C:\Users\ahajmousa\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_*\rclone-v*-windows-amd64\rclone.exe` (NOT on PATH in fresh shells). Remote `gdrive:` is OAuth-configured (hajmousa@gmail.com); upload folder `gdrive:quran-app-apks/`. Stream build→Drive in one hop with `rclone copyurl "<url>" "gdrive:quran-app-apks/<name>.apk"` (no local disk), then `rclone link <path>` for a shareable URL.
- **WSL↔Windows bridge:** the release script runs in WSL but calls the Windows `rclone.exe` by its `/mnt/c/...` path — WSL interop executes the `.exe`, so one bash script spans both eas (WSL) and rclone (Windows).
- Caveat: rclone's **shared Google client_id is being retired "during 2026"** — make a personal client_id (rclone.org/drive/#making-your-own-client-id) to future-proof the uploads. See [[android-apk-to-gdrive]].

### QR-code install (iOS-style, no Drive needed)

The `preview` profile is `distribution: internal`, so **every Android build also gets an EAS build page with a scannable QR** — the exact analog of the iOS install flow. The build page URL is `https://expo.dev/accounts/ahajmousa/projects/mobile/builds/<build-id>` (the release script prints it as `QR install page`; `eas build` without `--json` also prints an ASCII QR + a `See logs:` URL). Tester flow: open the build page → scan QR with the **Android camera** (or open the link directly) → **Download** → install (allow "install unknown apps" for the browser once).

Unlike iOS ad-hoc, **Android internal distribution does NOT require device registration** — anyone with the link can install. So the QR page is the simplest channel; Drive is just a versioned archive/backup on top of it.

## EAS Update (OTA) — ship JS changes without rebuilding

`expo-updates` is installed, so a shipped APK can pull **JS/asset-only** updates over the air — no rebuild, no re-upload, no re-install. Channels `preview` and `production` exist, each mapped 1:1 to a same-named branch.

**One command (run from WSL Ubuntu):**
```bash
bash mobile/scripts/push-ota.sh "what changed"
```
Wraps `eas update --branch preview --environment preview --message "..." --non-interactive`.

- **The `--environment` flag is REQUIRED in `--non-interactive` mode** — without it the command errors ("The `--environment` flag must be set...").
- **Runtime version gate:** an OTA update only reaches installed builds whose `runtimeVersion` matches. Policy is `appVersion`, so runtime = `app.json` `version`. Change JS but keep the same `version` → OTA reaches the current APK. Bump `version` → you must rebuild + redistribute an APK first; OTA won't cross versions.
- **Native changes** (new native module, permissions, SDK bump) always need a full APK rebuild — OTA can't ship native code.

## iOS — cloud build, install on device (no Mac)

iOS has no local `ios/` dir — everything is EAS cloud. Full detail in [[ios-eas-build-setup]].

### One-time: register the device (required for internal/ad-hoc builds)

The device UDID must be in the provisioning profile. In an interactive WSL terminal:

```bash
cd /mnt/c/Repo/quran-app/mobile
eas device:create
```

**The Website/Safari method FAILED on the old iPhone 11** (no "download a configuration profile" popup). **Use the `Input` (type-in-UDID) method instead.** Get the UDID on Windows: Apple Devices app (or iTunes) over USB → click the serial field to cycle to UDID → copy. Registered iPhone 11 UDID: `00008030-000C54A23C33802E`. Verify: `eas device:list --apple-team-id R3V63T48HF`.

### Build

```bash
cd /mnt/c/Repo/quran-app/mobile
eas build -p ios --profile development   # dev client: JS loads live from Metro
# or
eas build -p ios --profile preview       # standalone: JS embedded, runs without a dev server
```

Credentials prompts → say **Yes** (EAS generates/reuses the Distribution Cert + Provisioning Profile, auto-including registered devices). Build runs ~4–15 min on Expo's Mac cloud, ends with a build URL + QR.

### Install on the iPhone

1. **Scan the finished-build QR with the Camera app** (or open the EAS **build page** URL in Safari) → tap **Install**. 
   - **Do NOT open the raw `...artifacts/eas/....ipa` link** — that triggers the "looking for iTunes" dead end. Use the build page / QR, which serves an `itms-services` install manifest.
2. App installs under the "mobile" name (Quran icon). If it's hiding, Spotlight-search "mobile" or check App Library.
3. **development builds require Developer Mode:** Settings → Privacy & Security → **Developer Mode** → On → Restart → confirm "Turn On" with passcode. (A `preview` ad-hoc build does NOT need Developer Mode.)
4. If "Untrusted Developer": Settings → General → VPN & Device Management → tap the Apple Development cert → **Trust**.

### Run the dev client (JS loop)

The dev client loads JS from **Metro running on Windows via bun** — the WSL `node_modules` has no working `expo` binary (it's a Windows/bun install).

```powershell
cd C:\Repo\quran-app\mobile
bunx expo start --dev-client
```

iPhone and PC on the **same Wi-Fi** (iPhone is NOT in airplane mode, unlike the S24) → open the `mobile` app → tap the listed dev server, or scan the Metro QR with the Camera. Allow Node/bun through Windows Firewall (private) on first run. If LAN is blocked, use `bunx expo start --dev-client --tunnel`.

## Quick reference

| I want to... | Command / action |
|--------------|------------------|
| Android JS iterate | `adb reverse` → `bunx expo start --clear` → push `exp://127.0.0.1:8081` |
| **Release Android APK → Drive** | WSL: `bash mobile/scripts/release-android-drive.sh` (agent can run this) |
| **Ship a JS-only change (OTA)** | WSL: `bash mobile/scripts/push-ota.sh "msg"` (agent can run this) |
| iOS JS iterate (dev client installed) | `bunx expo start --dev-client` (Windows), same Wi-Fi |
| New iOS dev build | WSL: `eas build -p ios --profile development` |
| iOS standalone (no dev server) | WSL: `eas build -p ios --profile preview` |
| Check iOS build status | PS: `wsl ... eas build:list --platform ios --limit 1 --non-interactive` |
| Register new iOS device | WSL: `eas device:create` → **Input** → paste UDID |
| Install an iOS build | Camera-scan the build-page QR → Install (never the raw .ipa) |

## Common mistakes

- Running `eas` / `expo` in the wrong place → "command not found". eas = WSL; expo/Metro = Windows bun.
- `--localhost` on Android → IPv6 bind mismatch with adb reverse. Use plain `bunx expo start`.
- Opening the raw `.ipa` artifact on iPhone → "looking for iTunes". Use the build-page QR.
- Forgetting Developer Mode → "mobile requires Developer Mode to run".
- Expecting the Safari device-registration profile to work on the old iPhone — it doesn't; register by UDID.
- `eas update` in `--non-interactive` mode without `--environment` → errors. Pass `--environment preview`.
- Publishing an OTA after bumping `app.json` `version` → it won't reach the old APK (runtimeVersion gate). Rebuild the APK instead.
- `rclone.exe` not found → it's not on PATH in fresh shells; use the full `...\WinGet\Packages\Rclone.Rclone_*\...\rclone.exe` path.

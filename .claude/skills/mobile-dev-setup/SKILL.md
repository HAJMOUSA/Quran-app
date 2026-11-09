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

**Interactive commands (`login`, `init`, `build`, `device:create`, `submit`) must be run by the user in their own interactive Ubuntu/WSL terminal** — the agent can't drive the Expo/Apple prompts. In an interactive shell nvm auto-loads from `.bashrc`, so `eas` resolves directly (no PATH juggling).

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

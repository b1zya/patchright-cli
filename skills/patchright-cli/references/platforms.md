# Platforms: Linux, Windows, macOS

Read this when `patchright-cli env` reports no display or a virtual one, when `--headed` is refused, when a browser fails to start on macOS, or when a console window flashes on Windows. The decision between headless and headed is in SKILL.md ("Headless or headed"); this file is what each platform adds to it.

## What the tool actually does, on every platform

- It starts the browser executable directly and drives it over the Chrome DevTools Protocol through a pipe (Patchright). There is no AppleScript, no System Events, no accessibility API, no OS-level keyboard or mouse injection and no screen capture outside the browser: `click`, `type` and `--humanize` dispatch input events inside Chrome, `screenshot` is rendered by Chrome.
- The client and the background daemon talk over a Unix domain socket (a named pipe on Windows) under the temp directory, never over TCP.
- Profiles, cookies and identities live under the user cache: `~/.cache/patchright-cli` (Linux, or `$XDG_CACHE_HOME`), `~/Library/Caches/patchright-cli` (macOS), `%LOCALAPPDATA%\patchright-cli` (Windows), or `PATCHRIGHT_CLI_HOME`. Snapshots, screenshots and traces go to `<workspace>/.patchright-cli/`.
- Headless (the default) opens no window, takes no focus and triggers no permission dialog. Headed launches the browser as an ordinary application: a window, a taskbar or Dock entry, focus. Nothing else changes between the two modes: the Patchright patches, the profile and the identity are the same.

## Linux

| situation | what happens | do |
|---|---|---|
| no `DISPLAY` or `WAYLAND_DISPLAY` (server, container, CI, SSH) | the default (headless) runs; `--headed` is refused with the reason | keep the default; for a task that truly needs a window, `xvfb-run -a patchright-cli ...` (install `xvfb`) |
| display from `xvfb-run` | `env` says available but not human-visible; `--headed` renders off-screen | fine for a site that only renders headed; `wait-for-user` still refuses, because nobody can see that screen (an Xvfb started by hand, without `xvfb-run`, is indistinguishable from a real screen in the environment and counts as visible) |
| first run on a bare server: `error while loading shared libraries` (`libnss3`, `libatk`, `libgbm`, ...) | Chrome's system libraries are missing; headless needs the same set as headed | install Google Chrome from its `.deb`/`.rpm` (it pulls them in), or `patchright-cli install-browser chromium --with-deps` (bundled Chromium, detectable) |
| running as root in a container: `Running as root without --no-sandbox is not supported` | Chromium refuses; the tool never adds `--no-sandbox` itself | run the container as a non-root user; knowingly, `patchright-cli open --extra-arg=--no-sandbox` (warns) |

## Windows

- Display: a logged-in desktop session can show a window. An OpenSSH session or a service (session 0) cannot; `env` reports it and the default (headless) still works there, while `--headed` is refused with the reason.
- Console windows (investigated on Windows 11 with a window-enumeration probe, and in the sources):
  - Every process this client starts (the daemon, its own re-invocations for `batch` and `selftest`, the `chcp` probe, the PowerShell used by `kill-all`) is created with `windowsHide` (`CREATE_NO_WINDOW`); a unit test keeps it that way. `open` shows nothing in headless mode, and only the Chrome window in headed mode.
  - The browser binary is started by patchright-core without `windowsHide`. That is harmless: `chrome.exe` and `msedge.exe` are GUI-subsystem executables and never get a console.
  - What can flash briefly at `close`: the core force-kills the browser through a `taskkill` started via a shell without a hidden window; the daemon has no console, so Windows allocates one, which on Windows 11 opens the default terminal application for a fraction of a second. That is core behavior (a newer core hides the window; the roll checklist verifies it) and there is no safe client-side way around it: the daemon must run detached and without a console to outlive the client, so any console child it starts gets a new console.
- If a window still appears at `open`, it is not this tool: check the shell wrapper or the harness that started `patchright-cli`.

## macOS

### Permissions (Privacy & Security, TCC)

Ordinary browser automation with this tool needs none of Accessibility, Automation (Apple Events), Input Monitoring, Screen Recording, Full Disk Access, Camera, Microphone or Developer Tools. The browser is controlled over CDP through a pipe, input is dispatched inside Chrome, screenshots are rendered by Chrome. patchright-core bundles a default-browser helper that would run `osascript` (System Events), but no code path this tool uses calls it. Do not grant any of these permissions "just in case"; if a future feature needed one, it would say which one and why.

What can come up, and only under these conditions:

- **Files and Folders**: macOS asks when the *terminal application* (or the agent's host application, since the prompt belongs to the process tree that ran the command) first touches Desktop, Documents, Downloads, a removable or a network volume. That happens only if the workspace (output dir `.patchright-cli/`), `--profile` or `PATCHRIGHT_CLI_HOME` points there. The decision is remembered per application; a denial shows as `EPERM` / `Operation not permitted` when writing a snapshot or the profile, not as a browser error. Keep the default cache location and a workspace outside those folders, and nothing is asked. In managed fleets the decision can be pre-configured (PPPC profiles); unattended runs should not depend on a prompt.
- **Local Network**: not involved. The daemon socket is a Unix domain socket and the browser's traffic is ordinary outbound networking; the prompt exists for LAN and mDNS traffic (a site on 192.168.x.x would trigger it inside Chrome, as in any browser).
- **Headed only**: Chrome becomes a running application (Dock, window, focus). Headless opens nothing and asks nothing.

Unattended macOS (SSH, a LaunchDaemon, CI without a logged-in user): there is no Aqua window server, `env` reports the display as NOT available, the default (headless) works and `--headed` is refused with the reason. The tool decides from the environment alone, which is a heuristic: SSH markers mean no GUI session; markers left by a GUI terminal or IDE (`__CFBundleIdentifier`, `TERM_PROGRAM`) mean one; with neither, a GUI session is assumed. `launchctl managername` prints `Aqua` in a GUI session and `Background` otherwise, which is the definitive check when in doubt. macOS has no Xvfb equivalent; a virtual display means a logged-in session (auto-login and screen sharing), which is outside this tool.

### Gatekeeper, quarantine, signing, architecture

- Google Chrome and Microsoft Edge are notarized universal applications; the tool launches them straight from `Contents/MacOS`, so Gatekeeper is not involved beyond their own installation, and they run natively on Apple Silicon and Intel. Rosetta is neither required nor assumed.
- The bundled Chromium (`patchright-cli install-browser chromium`) is downloaded and unpacked by patchright-core itself (Node's HTTP client and its own unzip), so the `com.apple.quarantine` attribute is not applied and executing the binary directly does not go through Gatekeeper. The build is selected per architecture (`mac-arm64` versus `mac-x64`), so it is native too. A copy obtained through a browser or moved with the Finder can carry the quarantine flag and be blocked ("cannot be opened because the developer cannot be verified"): reinstall it with `install-browser`; do not disable Gatekeeper or SIP.
- The tool never modifies, re-signs or wraps the browser; it only passes flags. It never asks for `sudo`.

### Diagnostics

| symptom | cause | do |
|---|---|---|
| `You asked for a headed browser ... not an interactive macOS GUI session` | no Aqua session (SSH, LaunchDaemon) | run from the desktop session, or drop `--headed` |
| `... executable not found` / `not installed` from `open` | the channel is not installed | `patchright-cli doctor`; install Chrome or Edge, or `install-browser chromium` |
| `Operation not permitted` / `EPERM` writing a snapshot or the profile | Files and Folders denied for the terminal application, or a protected path | move the workspace or `PATCHRIGHT_CLI_HOME` out of Desktop/Documents/Downloads, or allow that folder for the terminal app |
| `cannot be opened because the developer cannot be verified`, or the browser dies at once with `Killed: 9` / `Code Signature Invalid` | a quarantined or damaged bundled Chromium | reinstall with `install-browser chromium`; use Google Chrome; never `spctl --master-disable` |
| `Bad CPU type in executable` | an x64 binary on Apple Silicon without Rosetta | reinstall (the download is architecture-specific) or use Google Chrome |
| `Permission denied` on the executable | lost executable bit (copied through a filesystem without permissions) | reinstall; do not `chmod` system applications |
| `Daemon process exited ...` with a driver message (`browserType.launch`, `Failed to launch`) | the browser process itself failed | read the `.err` text printed with the error; a profile lock from another instance is cleared by `patchright-cli close-all` |
| the same, but the message starts with `You asked for a headed browser` or `--browser ...` | this tool's launcher refused before starting Chrome | follow the message; nothing was launched |

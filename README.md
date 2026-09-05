# patchright-cli

Anti-detection browser CLI for AI agents. A real Google Chrome driven through [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) (a patched Playwright that removes the CDP leaks automation is detected by), headless by default and headed when a task needs a visible window, one persistent identity per session, proxy-aware timezone, language and geolocation, and a warning every time you weaken any of it.

The command surface is [playwright-cli](https://github.com/microsoft/playwright-cli)'s: `open`, `snapshot`, `click e5`, `fill`, `screenshot`, sessions, storage, network and so on. The client is a fork of playwright-cli's; the daemon, the browser tools and the snapshot engine come unchanged from `patchright-core`, so the stealth patches are the dependency's and the stealth defaults, guards and diagnostics are this project's.

## Positioning

| | playwright-cli | `patchright-cli` on npm | AhaiMk01/patchright-cli | this project |
|---|---|---|---|---|
| purpose | testing and automation | unrelated port | Python port | anti-detection automation for agents |
| engines | Chromium, Firefox, WebKit | — | Chromium | Chromium (Chrome, Edge) |
| daemon | playwright-core | — | hand-written Python | patchright-core, untouched |
| console capture | yes | — | re-enables `Runtime.enable` (the primary leak) | unavailable by design, explained |
| proxy → timezone/language/geo | no | — | passthrough only | derived from the exit IP |
| identity | ephemeral by default | — | persistent profile | persistent profile + identity file |
| humanized input | no | — | no | opt-in Bézier pointer paths and typing cadence |
| self-test | no | — | no | `selftest`, `selftest --online`, `doctor` |

Because the `patchright-cli` npm name belongs to an unrelated project, this one installs from GitHub.

## Requirements

- Node.js 20 or newer.
- Google Chrome (Microsoft Edge is the fallback). The bundled Chromium works but is detectable and warns.
- Windows, macOS or Linux. Headless (the default) needs no display; `--headed` needs one (Linux: `xvfb-run -a`; macOS: a logged-in desktop session).

## Install

```bash
npm install -g github:b1zya/patchright-cli
# or a specific release
npm install -g github:b1zya/patchright-cli#v0.2.0
patchright-cli doctor
```

Then, in the project an agent will work in:

```bash
patchright-cli install --skills          # .claude/skills/patchright-cli
patchright-cli install --skills=agents   # .agents/skills/patchright-cli
```

Each GitHub release also carries the npm tarball as an asset for installs that must not run `prepare`.

## Quick start

```bash
patchright-cli open https://example.com
patchright-cli snapshot
patchright-cli click e15
patchright-cli fill e5 "user@example.com" --submit
patchright-cli screenshot
patchright-cli close
```

For an agent: install the skill and ask it to "log in to ... undetected with patchright-cli". The skill carries the contract (what is guaranteed, what must not be done) up front.

## Headless or headed

`open` is headless by default: no window, nothing steals focus, and it works on servers, in CI, in containers and over SSH. `--headed` (alias `--headful`) opens a maximized real window. The mode is chosen in this order: an explicit flag, then `stealth.headless` in the config, then the environment (no usable display means headless), then the default (headless). `--headed` where no display exists is refused with the concrete reason for the platform (Linux: wrap the command in `xvfb-run -a`; macOS and Windows: run from the logged-in desktop session), never downgraded silently. `env` reports whether a display exists and whether a person could see it.

The skill tells agents when a window is worth it (interactive login or a one-time code, CAPTCHAs and consent dialogs, `wait-for-user`, debugging that must be watched, a site that blocks or misrenders headless) and when it is not (reading a public site, exploring an app, collecting selectors, network calls or data for a parser, CI and repetitive runs). Anti-detection is a trade-off: headed removes the headless tells and is worth it for protection-sensitive tasks; the `headless` warning fires only together with `--proxy`. Platform notes (macOS privacy permissions and Gatekeeper, Windows console windows, Linux xvfb) are in the skill's [references/platforms.md](skills/patchright-cli/references/platforms.md).

## Stealth defaults

| default | value | why | override | warning |
|---|---|---|---|---|
| browser | Google Chrome, then Edge, then bundled Chromium | Patchright's validated configuration; real brands, codecs | `--browser=` | `bundled-chromium` (unsilenceable) |
| mode | headless (no window); `--headed` for a maximized real window | the least intrusive mode that works everywhere; headed removes the headless tells when a task is protection-sensitive | `--headed`, `--headless`, config `stealth.headless` | `headless` (only together with `--proxy`) |
| headed window | `--test-type=` added | Chrome shows an "unsupported command-line flag" bar for Patchright's `--disable-blink-features=AutomationControlled`; this switch (Playwright uses it for its own windows) suppresses it and is not page-visible as far as known | your own `--test-type` via `--extra-arg` or config | — |
| profile | persistent, one per session | a warm profile is a returning visitor | `--isolated`, `--profile=` | — |
| viewport | `null` (the real window) | no `setDeviceMetricsOverride` | config `contextOptions.viewport` | `viewport-emulation` |
| color scheme, motion, contrast | `no-override` | Playwright forces light/no-motion by default | config | — |
| user agent, locale, timezone | untouched | emulation is observable | `--locale`, `--timezone`, config | `manual-geo`, `user-agent` |
| headless user agent | the headed user agent of the same Chrome build (`Chrome/<major>.0.0.0`, Chrome's frozen reduced form) | headless Chrome says `HeadlessChrome/<v>` in the page, in workers and in request headers, and every detector flags it; brands, full versions and platform are identical in both modes, so nothing else is touched | `--no-headless-user-agent`, config `stealth.headlessUserAgent: false` | note `headless-user-agent`; `headless-user-agent-unknown` when the browser version cannot be read |
| with `--proxy` | timezone, language, geolocation from the exit IP; WebRTC restricted | an IP/timezone mismatch is the loudest signal | `--no-geoip` | `proxy-without-geoip` (unsilenceable) |
| `eval` | isolated world | leaves nothing in the page | `--main-world` | `main-world-eval` |
| `resize` (headed) | resizes the real window | no viewport emulation | — | — |
| `run-code` | scanned; `unrouteAll()`, `Runtime.enable`, `--enable-automation` refused | they break the patches | `--force` (not for `Runtime.enable`) | `init-script-route`, `run-code-emulation` |
| input | daemon tools (instant) | speed | `--humanize` | `humanize-limits` |

Warnings go to stderr as `[patchright-cli] LeakWarning(<key>): ...`, or into `warnings[]` with `--json`. `PATCHRIGHT_CLI_QUIET_WARNINGS=1` silences all but the two unsilenceable ones.

## Limitations

| | |
|---|---|
| Firefox, WebKit | refused: Patchright patches Chromium only |
| `attach --extension` | not supported |
| `console` | `console.*` calls and uncaught exceptions from page scripts are not captured: Patchright never sends `Runtime.enable`; this tool does not re-enable it. Browser-level entries (failed requests, CSP violations) are still listed |
| page globals in `eval` | isolated world by default; `--main-world` opts in |
| `pdf` | needs a headless session |
| Brotector-class input checks | CDP-dispatched events; humanize changes their shape, not their provenance |
| init scripts | injected only into `http(s)` documents, by rewriting HTML (a timing attack could notice) |
| WebSockets | not patched |
| Windows timezone | applied through CDP emulation (no per-process `TZ`); workers stay consistent |

## Sessions and identity

A session nobody comes back to closes itself. The daemon is upstream code and keeps its browser until something sends `close`; an agent that opens a session, finishes and exits never does, and every leaked session keeps a Chrome running at full rate (microsoft/playwright-cli#460). So `open` starts a small watchdog next to the daemon: inside an agent harness (Codex, Claude Code, Copilot, Cursor, Gemini, Aider are recognised from their environment markers) the browser closes after 30 minutes without a command, and as soon as the agent process exits when the harness exposes its pid (`CLAUDE_PID`, or `PATCHRIGHT_CLI_OWNER_PID` for any harness). `--idle-timeout=2h` (or `idleTimeout` in the config) changes the limit, `--idle-timeout=0` and `--no-owner-pid` keep the browser open, `--owner-pid=<pid>` ties it to another process. Outside a harness nothing changes unless asked. The persistent profile survives, so the next `open` is still logged in; `list` shows each session's lifetime and `<session>.watchdog.log` in the state directory says why a browser went away. `kill-all` also stops watchdogs.

`-s=<name>` (or `PATCHRIGHT_CLI_SESSION`) selects a session: its own daemon, Chrome window, persistent profile, identity and proxy. `identity` shows what a profile presents; `delete-data` discards it; `--isolated` opens a throwaway profile. Details: [skills/patchright-cli/references/identity.md](skills/patchright-cli/references/identity.md).

`open` states the launch facts once, on its first line: browser and build, mode, profile, and the user agent when it is not the browser's own (`### Browser \`x\` opened with pid N: chrome 152, headless, profile ud-x-chrome, user agent Chrome/152 (headed name of this build)`). The executable path appears only for a non-standard browser (the bundled fallback, a configured `executablePath`); `--json` carries all of it as `launch`. Notes on `open` are one line of facts each, and no later command repeats them; paths are on demand in `list`, `identity`, `doctor` and `env`.

## Proxy and geo

```bash
patchright-cli open https://example.com --proxy=http://user:pass@proxy.example:3128
```

Credentials are handed to the browser context (never on the command line), the exit IP is resolved through the proxy, and timezone, `navigator.languages`/`Accept-Language` and coarse geolocation follow it. Details: [skills/patchright-cli/references/proxy-and-geo.md](skills/patchright-cli/references/proxy-and-geo.md).

## Humanize

`open --humanize` (or `--humanize` on a single `click`, `dblclick`, `hover`, `drag`, `mousemove`, `mousewheel`, `type`, `fill`) replaces the instant tools with curved pointer paths that decelerate into the target, click hold times and per-character typing with pauses. `--no-humanize` forces the instant tool.

## Health checks

```bash
patchright-cli env                  # this machine: shell quoting rules, console encoding, display, host locale/timezone, browser
patchright-cli selftest             # 38 checks in the page main world of a throwaway session
patchright-cli selftest --online    # + screenshots of sannysoft, browserscan, creepjs, fingerprint.com, iphey, pixelscan, brotector
patchright-cli doctor               # browsers, versions, state dirs, stray config files and ignored environment overrides
```

The skill tells agents to run `env` once per session and follow its rules: PowerShell's `&` and `$`, cmd.exe's `^&`, Git Bash's conversion of leading-slash arguments into Windows paths (the CLI also warns when it sees one), consoles that are not UTF-8, Linux boxes without a display. The skill itself is plain Markdown with standard frontmatter and works with any agent that reads `SKILL.md` files (`.claude/skills/`, `.agents/skills/`, or copy the folder).

## Sandboxes and permission modes

Agent harnesses (Codex CLI, Claude Code, Cursor, Copilot, CI containers) differ in what a command may do. `env` reports the host and sandbox markers, whether the state root is writable and, with `--probe`, whether the process has network. For sandboxes that kill background processes between tool calls, and for permission modes that confirm every command, `batch` runs a whole flow in one invocation:

```bash
printf '%s\n' 'open https://shop.example/login' 'fill e1 "user@example.com"' 'fill e2 "hunter2" --submit' 'snapshot' 'close' > flow.txt
patchright-cli -s=shop batch flow.txt
```

Some steps are the user's to do: a password the agent's own policy will not type, a one-time code, a consent dialog, a challenge they choose to pass themselves. `wait-for-user 300` hands the visible window over and returns with a fresh snapshot as soon as the page navigates. It refuses on a headless session or a virtual display, because nobody can type into a window they cannot see.

When the default state root is read-only, point it at the workspace: `PATCHRIGHT_CLI_HOME=$PWD/.patchright-cli/home` (keep `.patchright-cli/` out of version control: profiles hold cookies). The skill instructs agents to report denied permissions and sandbox limits instead of working around them, to keep profiles, state files and proxy credentials out of transcripts, and never to run `run-code` on code taken from a page.

## Commands

Core: `open attach close detach goto type click dblclick fill drag drop hover select upload check uncheck snapshot find eval dialog-accept dialog-dismiss resize run-code delete-data` · Navigation: `go-back go-forward reload` · Keyboard: `press keydown keyup` · Mouse: `mousemove mousedown mouseup mousewheel` · Save as: `screenshot pdf` · Tabs: `tab-list tab-new tab-close tab-select` · Storage: `state-load state-save cookie-* localstorage-* sessionstorage-*` · Network: `requests request request-headers request-body response-headers response-body route route-list unroute network-state-set` · Diagnostics: `console tracing-start tracing-stop video-* show generate-locator highlight config-print` · Stealth and environment: `env batch wait-for-user identity selftest doctor` · Sessions: `list close-all kill-all install install-browser`.

`patchright-cli --help` and `patchright-cli <command> --help` are always current; the skill at [skills/patchright-cli/SKILL.md](skills/patchright-cli/SKILL.md) documents everything for agents.

## Configuration

Global `~/.patchright-cli/config.json` (or `PATCHRIGHT_CLI_CONFIG`), then `.playwright/patchright-cli.config.json` under the workspace (or `--config=<file>`), then each file's `sessions.<name>` block, then command-line flags.

```json
{
  "stealth": { "browser": "chrome", "humanize": true, "proxy": "http://user:pass@proxy.example:3128" },
  "browser": { "contextOptions": { "locale": "de-DE" } },
  "timeouts": { "action": 5000, "navigation": 60000 },
  "sessions": {
    "us": { "stealth": { "proxy": "http://user:pass@us.proxy.example:3128" } }
  }
}
```

Everything outside `stealth` and `sessions` is passed to the daemon as its configuration (`browser.launchOptions`, `browser.contextOptions`, `browser.initScript`, `network`, `timeouts`, `outputDir`, `secrets`, ...). A `.playwright/cli.config.json` left by playwright-cli is ignored; `doctor` points it out. `browser.launchOptions.executablePath` launches that file instead of an installed channel (a portable Chrome, an install outside the standard directories); it needs no channel on the machine, cannot be combined with `--browser`, and is warned about (`custom-executable`). The bundled Chromium counts as installed only when the revision this `patchright-core` wants is actually on disk (`PLAYWRIGHT_BROWSERS_PATH` or the platform cache directory); `doctor` shows what is found.

## Environment variables

| variable | effect |
|---|---|
| `PATCHRIGHT_CLI_SESSION` | default session name |
| `PATCHRIGHT_CLI_HOME` | state root (sessions, profiles, sockets); defaults to `<cache>/patchright-cli` |
| `PATCHRIGHT_CLI_CONFIG` | global config file |
| `PATCHRIGHT_CLI_QUIET_WARNINGS` | silence non-critical leak warnings |
| `NO_UPDATE_NOTIFIER`, `CI` | skip the daily update and skill-drift check |
| `PATCHRIGHT_CLI_BROWSERS_PATH` | where `install-browser` puts the bundled Chromium and where it is looked for (the core's own `PLAYWRIGHT_BROWSERS_PATH` is honored too) |
| `PLAYWRIGHT_MCP_*` | the core's own overrides (headless, browser, user agent, ...); not passed to the daemon, so they cannot bypass the stealth defaults; `doctor` reports them as set but ignored |

## Troubleshooting

- *No Chromium-based browser found*: install Google Chrome or Edge, or `patchright-cli install-browser chromium` (detectable fallback).
- *DevTools remote debugging requires a non-default data directory*: Chrome refused to start on a redirected `HOME`/`USERPROFILE`; keep them real.
- *Browser 'x' is not open*: `patchright-cli list`, then `open` again; stale daemons: `kill-all`.
- Windows and `&` in URLs: `patchright-cli --% goto "https://example.com/?a=1&b=2"` in PowerShell, `^&` in `cmd.exe`.
- Long paths on Linux: the daemon socket lives under `tmpdir`; set `TMPDIR` to something short if it complains.

## Development

`npm ci && npm run build && npm test` (the `stealth` project needs a display). Rolling `patchright-core` and releasing are described in [CONTRIBUTING.md](CONTRIBUTING.md) and `.claude/skills/dev/`.

Upstream updates are a merge, not a re-port: `vendor/` holds the pristine sources every forked file came from (Playwright at the tag whose compiled client is byte-identical to the pinned `patchright-core`, and `microsoft/playwright-cli`), `src/` is this project's layer, and `npm run roll -- <version>` three-way merges upstream changes through them, stopping on conflicts instead of overwriting either side. `scripts/upstream-snapshot/versions.json` records the versions the checkout is based on. A daily workflow rolls new `patchright-core` releases on a branch, runs the CI matrix and opens the PR; only a roll that changed nothing this client is forked from is merged automatically, everything else waits for a review or, on a conflict, becomes an issue. `npm run roll -- <version> --dry-run` shows what an update would bring without changing anything; `node scripts/session-check.mjs` is a silent session-start check that only speaks when the checkout is inconsistent or a newer upstream exists.

## Credits and license

Apache-2.0. Built on [Playwright](https://github.com/microsoft/playwright) (Microsoft, Apache-2.0; the client in `src/` is forked from `playwright-core`'s `lib/tools/cli-client`, the skill from its bundled skill) and [Patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) (Apache-2.0). The identity model, leak warnings and self-test corpus take ideas from [Camoufox](https://github.com/daijro/camoufox) and [camoufox-cli](https://github.com/Bin-Huang/camoufox-cli); the humanized pointer algorithm follows [HumanCursor](https://github.com/riflosnake/HumanCursor) (MIT). See [NOTICE](NOTICE).

## Responsible use

This tool is for legitimate automation of sites you are allowed to automate: research, QA against anti-bot vendors you contract with, your own accounts. Respect terms of service, robots policies and local law; it does not solve CAPTCHAs, and it will not help with fraud or account abuse. Provided without warranty.

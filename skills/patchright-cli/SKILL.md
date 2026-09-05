---
name: patchright-cli
description: Anti-detection browser automation for AI agents — real Chrome via Patchright, one persistent identity per session, proxy-aware timezone and language, humanized mouse and typing. Use when a site has bot detection or anti-bot gates (Cloudflare, Akamai, DataDome, Kasada, PerimeterX, Turnstile, reCAPTCHA, "Access denied", fingerprint checks); to browse, scrape or log in "undetected", "like a human" or without being blocked; for a proxy (HTTP/SOCKS5), a manual timezone or an identity kept between runs; to check how a browser looks to detectors (sannysoft, CreepJS); for any question about patchright-cli itself (flags, warnings, the missing console, reading page state); and for loosely phrased browser tasks when patchright-cli is the browser CLI installed. Not for writing browser test suites, Firefox/WebKit/Camoufox, another browser tool the user names for their own site, solving CAPTCHAs, explaining detection without automating, or debugging a page's own console output.
allowed-tools: Bash(patchright-cli:*)
---

# Anti-detection browser automation with patchright-cli

patchright-cli drives a real Google Chrome through Patchright, a browser driver patched to remove the protocol leaks automation is detected by. It runs headless by default and opens a visible window only when the task needs one. Every session keeps a persistent profile (its identity), and a background daemon keeps the browser open between commands.

## The contract

### What the tool guarantees by default

- Real Google Chrome (Edge as the fallback), headless by default and a maximized visible window with `--headed`, with the real OS color scheme and motion preferences; no `--enable-automation`, `navigator.webdriver` is `false`.
- No `Runtime.enable`, no `__playwright*`/`cdc_*` globals, no prototype patching: pages see an untouched Chrome.
- A persistent profile per session name, so cookies, storage, cache and history survive between commands and between runs.
- No user-agent, locale, timezone or viewport overrides unless you ask for them.
- `--proxy` derives a coherent timezone, language and geolocation from the exit IP.
- A `LeakWarning` on stderr every time you weaken any of this.

### What you must not do

| Do not | Why | Instead |
|---|---|---|
| `--browser=firefox` or `webkit` | refused: Patchright patches Chromium only | `chrome` (default) or `msedge` |
| `--headed` for a quick look at a public page | a window steals focus and cannot open on a server; nothing is gained | stay headless; add `--headed` only for the reasons in "Headless or headed" |
| `--headed` when `env` shows no display | Chrome cannot draw; the CLI refuses with the reason | let the default (headless) run, or `xvfb-run -a` on Linux |
| `console` | `console.*` calls and uncaught exceptions from page scripts are not captured: Patchright never sends `Runtime.enable`, and patchright-cli does not re-enable it; browser-level entries (failed requests, CSP violations) are still listed | `eval --main-world "() => ..."` or `run-code` to read application state; a console/error hook installed with `eval --main-world` when you need the page's own logs |
| assume `eval` sees page globals | `eval` runs in an isolated world by default | add `--main-world` when you need `window.*` of the page |
| `run-code` with `unrouteAll()` or `Runtime.enable` | refused: they break the stealth patches | unroute specific patterns; never re-enable Runtime |
| `resize`, `--device`, `--mobile`, `--locale`/`--timezone` by hand on protected pages | detectable emulation, or a mismatch with the IP | only when the task needs it; expect a warning |
| `attach --extension` | not supported | `attach --cdp=...` (your browser, your leaks) |
| `pdf` on a headed session | needs headless Chromium | the default headless session, `screenshot`, or a throwaway `open --headless --isolated` |
| `highlight`, `video-show-actions`, `show --annotate` on protected pages | they inject DOM the page can observe | use them on your own pages |
| mix proxies inside one session, or `state-load` another identity's state | burns the identity | one session = one identity = one proxy |
| solve or repeatedly click CAPTCHAs / challenges | detectable and outside the tool's scope | wait, re-snapshot, report to the user |

## Adapt to the system first

Once per session, before the first browser command:

```bash
patchright-cli env
```

It prints the shell it detected, the console encoding, whether a display exists, the host locale and timezone, the agent host and sandbox markers, whether the state root is writable, and the quoting rules that apply here (`--json` for a structured version, `--probe` also checks network access). Follow those rules for every later command; the CLI never changes the console settings itself. If a `find` or `eval` unexpectedly reports nothing, or a `[msys-path-conversion]` warning appears, the shell mangled the argument: fix the invocation, do not conclude the page lacks the content.

Sandboxes, permission modes that confirm every command (`batch` runs a whole flow as one approval), a read-only home, and the security rules for profiles, credentials and `run-code` are in [references/environments.md](references/environments.md); read it when `env` reports a sandbox or a limit. A denied permission or a sandbox limit is the user's decision: report it and ask, do not work around it.

## Headless or headed: the least intrusive mode that does the job

`open` is headless by default: no window, nothing steals focus, and it works on servers, in CI, in containers and over SSH. A visible window (`--headed`) is a deliberate choice for a concrete reason, never a stealth default. Decide in this order:

1. **What the user asked for.** "Headless", "no window", "in the background" mean `--headless`; "show me", "open a window", "headful", "so I can see it" mean `--headed`. Honor it unless it is impossible. If `--headed` is refused because no display exists, tell the user that concrete limitation; never switch modes silently.
2. **What the task needs.** Interactive login or a one-time code, a CAPTCHA or consent dialog the user must answer, `wait-for-user`, watching rendering, focus, popups or windows while debugging: `--headed`. `pdf` needs headless.
3. **What the machine allows.** `env` says whether a display exists and whether a person could see it. With no display the default runs as is and `--headed` reports why it cannot (Linux: wrap the command in `xvfb-run -a`; macOS and Windows: run from the logged-in desktop session).
4. **Otherwise, from the task.** Headless for looking at a public site, exploring a single-page app, reading DOM, selectors, network calls or APIs, gathering what a parser will need, testing scraping logic, deterministic checks, CI and repetitive runs. Headed when the site fails or renders differently headless, when a protection trips only in headless, or when the task is openly anti-bot-sensitive and a display is available.

Do not open a window because a site "might" detect automation: real Chrome with a persistent profile is most of the anti-detection posture, Patchright's patches apply in both modes, and a headless session presents the headed user agent of the same build (`--no-headless-user-agent` keeps the raw one). Escalate to `--headed` on evidence (a block, a challenge, a page that only renders headed), and say why. `LeakWarning(headless)` appears only when headless meets `--proxy`, the one signal that the task is anti-detection-sensitive.

## Quick start

```bash
# open Chrome headless with a persistent profile; add --headed when the task needs a visible window
patchright-cli open https://example.com
# interact with the page using refs from the snapshot
patchright-cli click e15
patchright-cli fill e5 "user@example.com" --submit
patchright-cli press Enter
patchright-cli screenshot
# stop the browser; the profile stays for the next open
patchright-cli close
```

## Loose requests from non-technical users

Most people phrase tasks loosely: "check whether my site works", "log in and look at the order", "test the form on staging". The defaults are safe for ordinary sites, and the user need not know any term in this document.

- Start right away when a URL or site name is there; ask one question only when something is genuinely missing (which site? which account?).
- `open`, `snapshot`, then explore like a person: navigate, fill forms with obvious test values, click through the flow. Re-`snapshot` after every navigation. `screenshot` at meaningful points; a picture is what a non-technical user can verify.
- Report in the user's language, in plain words: what you did, what worked, what looked wrong (with the screenshot), what you did not try. Do not narrate refs, snapshots, sessions or warnings; mention a warning only when it changes the answer.
- Logins: one test account the user gave you for their own site, enter it yourself (next section). A second factor, a consent dialog or anything you will not type: hand over in a visible window (`close`, then `open --headed`, then `wait-for-user`), not in the conversation.
- "Test my form" on the user's own site: `open --isolated` keeps their real profile clean. "Check my account": the persistent profile, so they stay logged in next time.
- A bot check: follow "Handling challenge pages" and tell the user in one sentence; do not turn a simple check into a stealth investigation.
- Leave the browser as the user expects: `close` when done, unless they asked to keep it open (`--idle-timeout=0`; in an agent harness it otherwise closes after 30 idle minutes).

## Credentials the user gives you

People test their own products. When the user hands you one test account for a site they own or develop ("log in with admin / admin", "use the staging user"), entering it once into the login form is ordinary QA work, exactly what a human tester would do, and refusing leaves them stuck on step one. Do it: `fill` the login and the password, submit, `snapshot`, report what you see. The password appears in the command line because that is how a form gets filled; it is not a reason to stop, and the user already knows it.

What is not ordinary QA, and where you decline in one sentence and stop: guessing or brute-forcing passwords, working through a list of accounts or a credentials file, signing into an account that belongs to someone else, or getting around a second factor, a consent screen or a rate limit. One account, given by its owner, entered once, is none of these.

If your own policy still stops you from typing a credential, say so plainly and hand the login over instead of ending the task, in a window the user can see: the default session is headless, so `close` it and `open --headed` first. `--headed` refuses when there is no display a person can see (`xvfb-run` gives you a screen, not them), and `wait-for-user` refuses on a headless session: never ask the user to type into a browser they cannot see. Then wait:

```bash
patchright-cli open --headed https://app.example/login
patchright-cli wait-for-user 300     # returns as soon as the page navigates, or after 300 s
```

`wait-for-user` polls the page and returns with a fresh snapshot when the URL changes, so you continue from the state the user left. Use the same handover for a two-factor code, a consent dialog or a CAPTCHA that appears mid-flow: those are the user's to answer, not yours.

## Sessions and identity

```bash
# a named session: its own browser, profile, cookies and warnings
patchright-cli -s=shop open https://shop.example.com
patchright-cli -s=shop click e6
# what this profile presents: channel, locale, timezone, last geoip result
patchright-cli -s=shop identity
# throw the identity away (deletes the profile)
patchright-cli -s=shop delete-data
# without a name the session is "default"; or set PATCHRIGHT_CLI_SESSION=shop
```

- Profiles are persistent by default; `open --isolated` gives a throwaway in-memory profile (a new identity every time, which looks like a new device on every login).
- Parallel sessions are parallel identities and parallel Chrome windows; tabs inside one session share the identity.
- Pick a session name once per task and keep it (`login-acme`, `price-scan-42`); do not invent a new name for every command.
- `--profile=/abs/path` reuses a named identity across workspaces.
- A session nobody comes back to closes itself: in an agent harness, after 30 minutes without a command or when the agent process that opened it exits; `open` says so and `list` shows it. `--idle-timeout=2h` changes the limit, `--idle-timeout=0` and `--no-owner-pid` keep it open, `--owner-pid=<pid>` ties it to another process. The profile stays. Still `close` when a task is done.

See [references/identity.md](references/identity.md) and [references/session-management.md](references/session-management.md).

## Where things run

`open` answers "which browser, which profile" once, in its first line: `### Browser \`x\` opened with pid N: chrome 152, headless, profile ud-x-chrome, user agent Chrome/152 (headed name of this build)`. The executable path is printed only when it is not a standard channel (a bundled Chromium fallback, a configured `executablePath`); `--json` carries the full facts as `launch` (`channel`, `executablePath`, `version`, `headless`, `profileDir`, `userAgent`). Notes on `open` (`headless-user-agent`, `lifetime`) are one line of facts each; the why is in `references/stealth.md` and `references/session-management.md`. No later command repeats any of this.

Everything else is on demand: `list` for the profile directory of every session, `identity` for what a profile presents, `doctor` for the executables the machine has and the state root, `env` for the workspace and shell facts. Read `env` and `doctor` once per machine, `list` when you need a path or the user asks which browser you are using, never per command. When the user asks what is running, quote the launch line or `list`; do not guess.

## Proxy and geo

```bash
patchright-cli open https://example.com --proxy=http://user:pass@proxy.example:3128
```

With `--proxy`, geoip is on: the exit IP's timezone, language (`navigator.languages`, `Accept-Language`) and coarse geolocation are applied before launch. `--no-geoip` keeps the host values and prints an unsilenceable warning. `--locale`/`--timezone` override the derived values. The proxy is passed on every `open` and never stored; the derived values are recorded in the identity. SOCKS5 works without credentials only. See [references/proxy-and-geo.md](references/proxy-and-geo.md).

## Humanize

```bash
patchright-cli open https://example.com --humanize
patchright-cli click e5            # pointer travels along a curved path, then clicks
patchright-cli fill e7 "hello"     # clicks, clears, types character by character
patchright-cli click e5 --no-humanize   # the instant tool for this one command
```

Opt-in per session (`--humanize`, or `stealth.humanize` in the config) or per command. Slower, and honest about its limit: events are still CDP input events, so event-provenance checks (Brotector-class) are not defeated.

## Reading warnings

Warnings look like `[patchright-cli] LeakWarning(headless): ...` on stderr; with `--json` they are in `warnings: [{key, severity, message}]`. When a warning is about something you asked for, decide consciously and tell the user. `PATCHRIGHT_CLI_QUIET_WARNINGS=1` silences all but `bundled-chromium` and `proxy-without-geoip`. See [references/stealth.md](references/stealth.md) for the catalog.

## Health checks

```bash
# this machine: shell rules, console encoding, display, host locale/timezone, default browser
patchright-cli env
# offline: automation markers, tampering, headless tells, worker consistency, geo coherence
patchright-cli selftest
# same, then open the public detector pages and save a screenshot of each
patchright-cli selftest --online
# environment: browsers, versions, directories, stray config and environment variables
patchright-cli doctor
```

`selftest` exits 1 on any critical failure. See [references/selftest.md](references/selftest.md).

## Commands

### Core

```bash
patchright-cli open
patchright-cli open https://example.com/
patchright-cli goto https://example.com/page
patchright-cli type "search query"
patchright-cli click e3
patchright-cli dblclick e7
patchright-cli fill e5 "user@example.com" --submit
patchright-cli drag e2 e8
patchright-cli drop e4 --path=./image.png
patchright-cli drop e4 --data="text/plain=hello world"
patchright-cli hover e4
patchright-cli select e9 "option-value"
patchright-cli upload ./document.pdf
patchright-cli check e12
patchright-cli uncheck e12
patchright-cli snapshot
patchright-cli find "Sign in"
patchright-cli find --regex "/sign (in|up)/i"
# isolated world (default): DOM reads, no page globals
patchright-cli eval "document.title"
patchright-cli eval "el => el.getAttribute('data-testid')" e5
# page main world: application state, window.* globals (function or bare expression)
patchright-cli eval --main-world "() => window.__APP_STATE__"
patchright-cli --raw eval --main-world "JSON.stringify(window.__APP_STATE__.cart)"
patchright-cli dialog-accept
patchright-cli dialog-accept "confirmation text"
patchright-cli dialog-dismiss
# headed: resizes the real window; no viewport emulation
patchright-cli resize 1280 900
patchright-cli close
```

### Navigation, keyboard, mouse

```bash
patchright-cli go-back                 # also go-forward and reload
patchright-cli press Enter             # press ArrowDown ; keydown Shift ; keyup Shift
patchright-cli mousemove 150 300
patchright-cli mousedown right         # mousedown ; mouseup ; mousewheel 0 100
```

### Save as

```bash
patchright-cli screenshot
patchright-cli screenshot e5
patchright-cli screenshot --filename=page.png
patchright-cli screenshot --hires
# pdf needs a headless session (see the contract)
patchright-cli pdf --filename=page.pdf
```

### Tabs

```bash
patchright-cli tab-new https://example.com/page   # tab-list ; tab-select 0 ; tab-close 2
```

### Storage

```bash
patchright-cli state-save auth.json               # state-load auth.json restores it
patchright-cli cookie-list --domain=example.com   # cookie-get NAME ; cookie-delete NAME ; cookie-clear
patchright-cli cookie-set session_id abc123 --domain=example.com --httpOnly --secure
patchright-cli localstorage-set theme dark        # localstorage-list ; localstorage-get theme ; localstorage-delete theme ; localstorage-clear
patchright-cli sessionstorage-set step 3          # sessionstorage-list ; sessionstorage-get step ; sessionstorage-delete step ; sessionstorage-clear
```

State files are bound to the identity that produced them; do not load them into another session's profile.

### Network

```bash
patchright-cli requests
patchright-cli request 5
patchright-cli request-headers 5
patchright-cli request-body 5
patchright-cli response-headers 5
patchright-cli response-body 5
# mocking changes what the site observes and disables the browser cache while active
patchright-cli route "**/*.jpg" --status=404
patchright-cli route "https://api.example.com/**" --body='{"mock": true}'
patchright-cli route-list
patchright-cli unroute "**/*.jpg"
patchright-cli unroute
patchright-cli network-state-set offline
patchright-cli network-state-set online
```

### Diagnostics

```bash
# page console output is unavailable by design; the command explains why
patchright-cli console
patchright-cli run-code "async page => await page.context().grantPermissions(['geolocation'])"
patchright-cli run-code --filename=script.js
patchright-cli tracing-start
patchright-cli tracing-stop
patchright-cli video-start video.webm
patchright-cli video-chapter "Chapter Title" --description="Details" --duration=2000
patchright-cli video-stop
patchright-cli video-show-actions --duration=600 --position=top-right
patchright-cli video-hide-actions
patchright-cli show --annotate
patchright-cli generate-locator e5 --raw
patchright-cli highlight e5
patchright-cli highlight --hide
patchright-cli config-print
```

### Stealth

```bash
patchright-cli env
patchright-cli env --probe
patchright-cli batch flow.txt
patchright-cli batch flow.txt --continue-on-error
# hand a step over to the user in the visible window; returns on navigation or timeout
patchright-cli wait-for-user
patchright-cli wait-for-user 300
patchright-cli identity
patchright-cli selftest
patchright-cli selftest --online
patchright-cli doctor
```

### Sessions and setup

```bash
patchright-cli list
patchright-cli close-all
patchright-cli kill-all
patchright-cli delete-data
# creates the .playwright workspace marker and copies this skill
patchright-cli install --skills
patchright-cli install --skills=agents
patchright-cli install-browser chromium
patchright-cli attach --cdp=http://localhost:9222
patchright-cli -s=cdp detach
patchright-cli tray
```

`pause-at`, `resume` and `step-over` are test-runner debugging commands and outside this tool's purpose.

## Raw and JSON output

`--raw` strips page status, generated code and snapshot sections and returns only the result value; warnings still go to stderr. `--json` wraps every reply as JSON and adds `warnings` when there are any.

```bash
patchright-cli --raw eval "JSON.stringify([...document.querySelectorAll('a')].map(a => a.href))" > links.json
patchright-cli --raw snapshot > before.yml
TOKEN=$(patchright-cli --raw cookie-get session_id)
patchright-cli list --json
```

## Open parameters

```bash
# defaults: chrome, headless (no window), persistent profile
patchright-cli open https://example.com
patchright-cli open --headed https://example.com   # visible, maximized window: interactive login, CAPTCHA, manual inspection, a site that blocks headless
patchright-cli open --browser=msedge
patchright-cli open --proxy=http://user:pass@host:3128
patchright-cli open --proxy=socks5://host:1080 --no-geoip --timezone=Europe/Berlin --locale=de-DE
patchright-cli open --humanize
patchright-cli open --isolated                 # throwaway in-memory profile (new identity)
patchright-cli open --profile=/path/to/profile # explicit persistent profile directory
patchright-cli open --window-size=1440x900     # instead of maximized
patchright-cli open --grant=geolocation        # permissions for every origin (unusual for a real user)
patchright-cli open --proxy=http://host:3128 --proxy-bypass=localhost,*.internal
patchright-cli open --no-focus-emulation       # pages see the real window focus (default: --focus-emulation on)
patchright-cli open --extra-arg=--disable-gpu  # unvetted chromium switch; warns
patchright-cli open --idle-timeout=2h          # close after 2h without a command (agent default 30m; 0 = never)
patchright-cli open --owner-pid=12345          # close when that process exits (default: CLAUDE_PID / PATCHRIGHT_CLI_OWNER_PID; --no-owner-pid disables)
patchright-cli run-code --force "async page => ..."   # override the safety scan (never for Runtime.enable)
patchright-cli open --headless                 # explicit; already the default (warns only together with --proxy)
patchright-cli open --no-headless-user-agent   # headless keeps Chrome's own HeadlessChrome user agent (default: --headless-user-agent, the headed name of the same build)
patchright-cli open --mobile                   # device emulation; warns
patchright-cli open --device="iPhone 15"       # device emulation; warns
patchright-cli open --config=my-config.json
patchright-cli attach --cdp=chrome             # a running Chrome with remote debugging; warns
patchright-cli attach --cdp=http://localhost:9222
```

## Snapshots

After each command, patchright-cli reports the page state and a snapshot with element refs.

```bash
> patchright-cli goto https://example.com
### Page
- Page URL: https://example.com/
- Page Title: Example Domain
### Snapshot
[Snapshot](.patchright-cli/page-2026-02-14T19-22-42-679Z.yml)
```

```bash
patchright-cli snapshot                          # save to a timestamped file
patchright-cli snapshot --filename=after-click.yaml
patchright-cli snapshot "#main"                  # an element instead of the whole page
patchright-cli snapshot --depth=4                # limit depth, then snapshot a subtree
patchright-cli snapshot e34
patchright-cli snapshot --boxes                  # include [box=x,y,width,height]
patchright-cli find "Add to cart"                # search instead of capturing everything
patchright-cli find --regex "\\$[0-9]+\\.[0-9]{2}"
```

## Targeting elements

Use refs from the snapshot; CSS selectors and locator expressions (`getByRole(...)`, `getByTestId(...)`) also work. Refs look like `e15`, or `f1e6` for an element inside a frame; pass them exactly as printed.

Snapshot refs belong to the snapshot they came from: any navigation (clicking a link, submitting a form, `goto`, `reload`) invalidates them. After the page changes, take a fresh `snapshot` and use the new refs. If a command reports `Ref … not found in the current page snapshot. Try capturing new snapshot` or `"…" does not match any elements`, the page moved on or the element is not there — re-snapshot and look again; it does not mean the tool stopped working, so do not instrument the page or fall back to raw HTTP. CSS/text selectors and `aria-ref=` re-resolve on every command, so they survive navigations when a ref would not.

```bash
patchright-cli click e15
patchright-cli click "#main > button.submit"
patchright-cli click "getByRole('button', { name: 'Submit' })"
patchright-cli click "getByTestId('submit-button')"
```

## Handling challenge pages

If the snapshot shows "Checking your browser", "Verify you are human", a Turnstile widget or an interstitial:

1. Wait: `patchright-cli run-code "async page => page.waitForLoadState('networkidle')"`, then `snapshot` again, at most twice.
2. `screenshot` and show the user what the page looks like.
3. Do not click the challenge repeatedly, do not reload in a loop, do not switch sessions or proxies in the middle of a flow: each attempt lowers the reputation of the identity and the IP.
4. If the session is headless, retry once headed (`close`, then `open --headed`): some protections trip only on headless tells. If it persists, report it and stop, or hand it over: in a headed session `wait-for-user 300` lets the user answer the challenge in the visible window. A persistent block on a fresh identity is usually IP reputation, not the browser; a block that appears only after actions is usually behavioral.

## Installation

```bash
npm install -g github:b1zya/patchright-cli
patchright-cli doctor
patchright-cli install --skills
```

Requires Node.js 20+ and Google Chrome (or Microsoft Edge). Headless (the default) needs no display; `--headed` needs one (Linux: `xvfb-run -a`). Platform notes for Linux, Windows and macOS (displays, permissions, Gatekeeper, console windows) are in [references/platforms.md](references/platforms.md).

## Example: log in with a persistent identity

```bash
patchright-cli -s=acme open https://app.acme.example/login
patchright-cli -s=acme snapshot
patchright-cli -s=acme fill e1 "user@example.com"
patchright-cli -s=acme fill e2 "password123" --submit
patchright-cli -s=acme snapshot
patchright-cli -s=acme close
# next time, the session is still logged in
patchright-cli -s=acme open https://app.acme.example/account
```

## Example: a second identity behind a proxy, in parallel

```bash
patchright-cli -s=eu open https://shop.example --proxy=http://user:pass@eu.proxy.example:3128
patchright-cli -s=us open https://shop.example --proxy=http://user:pass@us.proxy.example:3128
patchright-cli -s=eu identity
patchright-cli -s=us identity
patchright-cli -s=eu --raw eval "document.querySelector('.price').textContent"
patchright-cli -s=us --raw eval "document.querySelector('.price').textContent"
patchright-cli close-all
```

## Specific tasks

* **Shells, sandboxes, permission modes and security** [references/environments.md](references/environments.md)
* **Linux, Windows and macOS: displays, permissions, Gatekeeper, console windows** [references/platforms.md](references/platforms.md)
* **How detection works and what this tool does about it** [references/stealth.md](references/stealth.md)
* **Proxy, geoip, timezone and language** [references/proxy-and-geo.md](references/proxy-and-geo.md)
* **Identity and profiles** [references/identity.md](references/identity.md)
* **Self-test and detectors** [references/selftest.md](references/selftest.md)
* **Browser session management** [references/session-management.md](references/session-management.md)
* **Running custom code with `run-code`** [references/running-code.md](references/running-code.md)
* **Request mocking** [references/request-mocking.md](references/request-mocking.md)
* **Storage state (cookies, localStorage)** [references/storage-state.md](references/storage-state.md)
* **Tracing** [references/tracing.md](references/tracing.md)
* **Video recording** [references/video-recording.md](references/video-recording.md)
* **Inspecting element attributes** [references/element-attributes.md](references/element-attributes.md)

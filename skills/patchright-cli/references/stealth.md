# How detection works, and what patchright-cli does about it

## Three layers of detection

1. **Protocol leaks.** Playwright normally calls `Runtime.enable`, installs init scripts with `Page.addScriptToEvaluateOnNewDocument`, exposes bindings as `__playwright__binding__` globals and launches Chrome with `--enable-automation`. Each of these is observable from page JavaScript.
2. **Launch and fingerprint tells.** Headless mode (hidden scrollbars, font overrides, software WebGL, a fixed 1280x720 viewport), a bundled "Chrome for Testing" build, emulated user agents, locales, timezones and viewports that contradict each other or the real hardware.
3. **Behavior and network.** An IP whose country does not match the browser timezone and language, instant pointer teleports, typing at machine speed, a profile that is brand new on every login.

Anti-bot vendors test each layer over and over; a single inconsistency is enough.

## What Patchright closes (layer 1)

- Removes every `Runtime.enable` call; execution contexts are discovered through `Runtime.evaluate` and `Page.createIsolatedWorld` instead. Side effect: `console.*` calls and uncaught exceptions from page scripts are not observable (browser-level log entries such as failed requests and CSP violations still are), which is why `console` explains itself instead of listing page logs.
- Injects init scripts by rewriting HTML documents through a catch-all route instead of `Page.addScriptToEvaluateOnNewDocument`; bindings get random names and no global object.
- Removes 13 automation-related Chromium switches (including `--enable-automation` and the large `--disable-features=` list) and adds `--disable-blink-features=AutomationControlled`; refuses the old headless mode and SwiftShader.
- Keeps the browser cache enabled unless you install routes; skips CORS preflight interception when there are no routes.
- Evaluates `page.evaluate` in an isolated world by default, so your own scripts do not leave traces in the page (use `--main-world` when you need page globals).
- Supports locators inside closed shadow roots.

## What patchright-cli adds (layers 2 and 3)

- Real Google Chrome (Edge fallback), persistent profile per session, `viewport: null`, real OS color-scheme and motion preferences. Headless by default; `--headed` gives a maximized real window, which removes the headless tells (font metrics, software WebGL, fixed viewport) and is worth it only when the task is protection-sensitive. Headed launches also carry `--test-type=`: Chrome lists Patchright's `--disable-blink-features=AutomationControlled` as an unsupported flag and would otherwise show a warning bar in the window (`--disable-infobars` no longer affects it); the switch is what Playwright passes to its own persistent-context windows and has no page-visible effect that we know of.
- Headless sessions present the headed user agent of the same Chrome build: headless Chrome says `HeadlessChrome/<v>` in `navigator.userAgent`, in workers and in the `User-Agent` header while its client-hint brands, `fullVersionList` and platform are identical to the headed build. The major version comes from the core registry for the bundled Chromium and from the installed executable for Chrome and Edge, and the rest is Chrome's frozen reduced user agent, applied as a context user agent (Chrome's `--user-agent` switch would blank the high-entropy client hints instead). `--no-headless-user-agent` keeps the raw one.
- `--proxy` with geoip: timezone through the process environment on Linux/macOS (CDP emulation on Windows), language through `--lang` plus the profile's Accept-Language preference (so `navigator.languages` has the natural several entries), coarse geolocation without a silent permission grant, WebRTC restricted to proxied routes.
- Guards: `run-code` is scanned for `unrouteAll()`, `Runtime.enable` and `--enable-automation`; `resize` moves the real window in headed sessions instead of emulating a viewport; Firefox/WebKit and extension attach are refused.
- Optional humanized input: curved pointer paths with deceleration, click hold times, per-character typing with pauses.
- A `LeakWarning` for every deviation, `selftest` to verify the posture, `identity` and `doctor` to see what the session presents.

## Residual leaks (known, documented)

- Init scripts (yours, or the ones `exposeFunction`/`clock.install` need) are injected by rewriting HTML; a timing attack could notice. No known vendor checks this.
- The headless user agent is a `Emulation.setUserAgentOverride` with metadata Playwright derives from the string: brands and full versions stay real, `platformVersion` becomes "10.0" on Windows and "10_15_7" on macOS instead of the build-derived value. No known vendor scores it; `selftest` reports the client-hint versions.
- Emulation APIs are not hidden: user agent, locale, timezone (on Windows), touch and viewport overrides remain observable as overrides. patchright-cli never sets them unless asked.
- `clock.install()` and WebAuthn leave `__pwClock` / `__pwWebAuthnBinding` globals.
- Input events are CDP-dispatched. Humanize makes them plausible in space and time, not in provenance; Brotector-class input checks are out of scope (that needs OS-level input).
- WebSockets are not patched; `data:` and `about:blank` pages get no init scripts.
- The bundled Chromium is detectable by brand; the tool warns loudly when it is all that is available.

## Warning catalog

| key | severity | meaning |
|---|---|---|
| `bundled-chromium` | HIGH, unsilenceable | no Chrome/Edge found, or `--browser=chromium` |
| `proxy-without-geoip` | HIGH, unsilenceable | `--proxy` with `--no-geoip` and no manual timezone/locale |
| `geoip-failed` | HIGH | the exit-IP lookup failed; host values kept |
| `headless` | MEDIUM | headless (the default) together with `--proxy` |
| `headless-user-agent` | INFO (note) | every headless launch: the user agent it presents |
| `headless-user-agent-unknown` | MEDIUM | headless when the browser version cannot be read, so `HeadlessChrome` stays |
| `custom-executable` | LOW | `browser.launchOptions.executablePath` in the config: that file is launched instead of an installed channel |
| `device-emulation` | HIGH | `--mobile`, `--device` |
| `user-agent` | HIGH | `contextOptions.userAgent` in the config |
| `manual-geo` | MEDIUM | `--timezone`/`--locale` while geoip is active |
| `timezone-emulation` | MEDIUM | Windows: timezone set through CDP |
| `viewport-emulation` | MEDIUM | fixed viewport, or `resize` in a headless session |
| `route-shadows-init` | MEDIUM | a route while init scripts are configured |
| `init-script-route` | MEDIUM | `run-code` using `addInitScript`/`exposeFunction`/`clock.install` |
| `run-code-emulation` | MEDIUM | `run-code` using `setViewportSize`, `setUserAgent`, `Emulation.*` |
| `highlight-dom` | MEDIUM | `highlight`, `video-show-actions` |
| `locale-emulation` | LOW | macOS: locale set through CDP |
| `route-cache` | LOW | routes disable the browser cache |
| `main-world-eval` | LOW | `eval --main-world` |
| `tracing` | LOW | `tracing-start` |
| `cdp-attach` | LOW | `attach --cdp` |
| `channel-changed` | LOW | a profile reopened with another browser channel |
| `extra-arg` | LOW | `--extra-arg` |
| `no-focus-emulation` | LOW | `--no-focus-emulation` |
| `console-unavailable` | INFO | `console` |
| `humanize-limits` | INFO | first humanized action of a session |

## Do / Don't

- Do keep one session per identity and one proxy per session; do let profiles age.
- Do read blocks: a block on a fresh identity before any interaction is usually IP reputation; one that appears after interactions is behavioral; one that appears only in headless or with `--device` is a fingerprint contradiction.
- Don't add stealth of your own through `run-code`: patching `navigator`, canvas noise or console shims are tamper signals that a clean Chrome does not have.
- Don't run `selftest --online` or protected sites from datacenter IPs and expect a clean result.

## What this tool deliberately does not do

No user-agent or OS spoofing, no canvas/WebGL/audio noise, no fingerprint generation or rotation, no `--disable-web-security` or `--no-sandbox`, no console shim, no CAPTCHA solving. Each of those either contradicts the real hardware or adds a signal a real Chrome does not carry.

# Self-test and detectors

```bash
patchright-cli selftest                      # default launch profile
patchright-cli selftest --proxy=http://...   # same, behind a proxy (adds the geo group)
patchright-cli selftest --headless           # see what headless costs
patchright-cli selftest --online             # then tour the public detector pages
patchright-cli selftest --json
```

`selftest` opens a throwaway session named `__selftest` with exactly the launch profile a normal `open` would get (same config, same flags), serves a small local page and runs the checks in the page main world. The session is closed afterwards. Exit code 1 means a critical failure.

## Offline checks

| group | what is checked | critical |
|---|---|---|
| automation | `navigator.webdriver` not true; no `__playwright*`, `__pw*`, `cdc_*`, `$cdc_*`, `__puppeteer*`, `_selenium`... globals in the page or its iframe; logging an error with a trapped `stack` getter reads it zero times (no `Runtime.enable`); `window.chrome` present; `navigator.plugins` populated | yes |
| tamper | native `toString` of key getters and methods (`hardwareConcurrency`, `screen.width`, `getImageData`, `getChannelData`, `getTimezoneOffset`, `resolvedOptions`, `Function.prototype.toString`); `navigator` has no own properties; canvas output stable across two passes | yes |
| headless | outer window dimensions; viewport differs from the screen; CSS `ActiveText` is not the headless red; hardware WebGL renderer; no `Headless` in the UA; fine pointer and hover media queries; several `navigator.languages`; `navigator.language` agrees with the Intl locale; notification permission consistency; focus (info) | no |
| workers | a dedicated worker reports the same user agent, platform, hardware concurrency, language and timezone as the main thread | yes |
| signals | platform vs user agent; desktop touch points; integer screen size; screen fits viewport; plausible hardware concurrency and color depth; taskbar space (info) | no |
| cache | an asset is served from cache on reload (routes disable the cache; Patchright keeps it otherwise) | no |
| geo | browser timezone and language match the identity derived from the proxy exit IP (skipped without proxy/geoip) | yes |

## Reading results

- `PASS`/`FAIL` are asserted, `INFO` is reported for you to judge, `SKIP` did not apply.
- Expected `WARN`-class results on some machines: a software WebGL renderer inside a VM without GPU passthrough, `availWidth === width` on setups without a taskbar. Neither is critical, both are visible to detectors.
- A failure in `automation` or `tamper` on a default launch means the environment is broken: run `doctor`, look for `PLAYWRIGHT_MCP_*` variables or a leftover `.playwright/cli.config.json`, and make sure a real Chrome is installed.

## Online detectors

`--online` opens each site in the same session, waits eight seconds and saves `selftest-<site>.png` in the output directory (`.patchright-cli/`). Nothing is scraped; read the screenshots. Run this from a residential connection: datacenter IPs are challenged regardless of the browser.

| site | expected |
|---|---|
| bot.sannysoft.com | every row green; `WebDriver (New)` false; Plugins 5 |
| browserscan.net/bot-detection | verdict "Normal"; no WebDriver or CDP findings |
| abrahamjuliot.github.io/creepjs | lies 0%, headless 0%, stable fingerprint across reloads |
| fingerprint.com/products/bot-detection | "You are not a bot" |
| iphey.com | "trustworthy"; IP, timezone and language rows consistent (with `--proxy`) |
| pixelscan.net | "consistent"; no automation framework |
| kaliiiiiiiiii.github.io/brotector | only the CDP input-event rows trigger; that check needs OS-level input, which is out of scope |

## When selftest fails

1. `patchright-cli doctor` — stray configuration and environment overrides are the usual cause.
2. Re-run with `--browser=chrome` if Edge or the bundled Chromium was picked.
3. Compare with `selftest --headless` / `--isolated` to see which deviation introduced the failure.

# Proxy, geoip, timezone and language

## Proxy syntax

```bash
patchright-cli open --proxy=http://user:pass@proxy.example:3128
patchright-cli open --proxy=https://proxy.example:443
patchright-cli open --proxy=socks5://proxy.example:1080        # no credentials: Chromium cannot authenticate to SOCKS
patchright-cli open --proxy=proxy.example:8080                  # schemeless = http
patchright-cli open --proxy=http://proxy.example:3128 --proxy-bypass=localhost,*.internal
```

Credentials are answered to the proxy's authentication challenge by the browser context; they never appear on the command line of the Chrome process, in `config-print` (the password is redacted) or in the identity file. The proxy must be passed on every `open` of the session; it is not remembered.

## What geoip derives

With `--proxy`, geoip is on unless you pass `--no-geoip`. Before the browser starts, the exit IP is resolved (through the proxy) with `ipinfo.io`, falling back to `ip-api.com`:

| derived | applied how | observable as |
|---|---|---|
| timezone | Linux/macOS: `TZ` in the browser environment; Windows: CDP timezone emulation (warns) | `Intl.DateTimeFormat().resolvedOptions().timeZone`, `Date` offsets, workers |
| language | `--lang=<locale>` plus `intl.accept_languages` in the profile (macOS: CDP locale, warns) | `navigator.language`, `navigator.languages` (several entries), `Accept-Language` |
| geolocation | context geolocation, no permission grant | only if the page asks and the user allows; `--grant=geolocation` pre-grants (unusual) |
| WebRTC | `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` | no host candidates that would reveal the real IP |

The language comes from a country-to-locale table (majority language: US→en-US, DE→de-DE, BR→pt-BR, CH→de-CH, ...). Override it when the identity should speak something else.

## Overrides and their warnings

```bash
# explicit values win over geoip; the mismatch risk is on you (warning: manual-geo)
patchright-cli open --proxy=http://p:3128 --timezone=Europe/Berlin --locale=de-DE
# no lookup at all (warning: proxy-without-geoip, cannot be silenced)
patchright-cli open --proxy=http://p:3128 --no-geoip
# resolve the host's own location without a proxy
patchright-cli open --geoip
```

If the lookup fails (`geoip-failed`), the host timezone and language stay; treat the session as mismatched with the IP.

## Rotating vs sticky proxies

Use sticky (session) proxies: an identity whose exit IP changes between requests contradicts its own timezone and looks like an account shared across countries. Rotating-per-request proxies are incompatible with coherence and with most login flows.

## Verifying coherence

```bash
patchright-cli identity                  # what was derived and when
patchright-cli selftest --proxy=...      # geo group compares the browser with the identity
patchright-cli --raw eval --main-world "() => [Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.languages]"
```

`selftest --online` with the same proxy shows how iphey/pixelscan see the IP-vs-browser consistency.

## Configuration

```json
{
  "stealth": { "proxy": "http://user:pass@proxy.example:3128", "geoip": true, "locale": "de-DE" },
  "sessions": { "us": { "stealth": { "proxy": "http://user:pass@us.proxy.example:3128", "locale": "en-US" } } }
}
```

Command-line flags override the config. The config file is read on the client; the proxy password only reaches the daemon through a private, short-lived file.

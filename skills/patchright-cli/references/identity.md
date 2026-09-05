# Identity and profiles

An identity is a persistent Chrome profile plus the geo-derived values it was last opened with. Chromium has no fingerprint generator to freeze: what makes a returning visitor look like the same person is the profile (cookies, storage, cache, history, first-run state) and consistent browser channel, timezone and language across opens.

## Where profiles live

- Default: one per session name under the tool's state root (`<cache>/patchright-cli/daemon/<workspace-hash>/ud-<session>-<channel>/`). `patchright-cli identity` prints the path.
- `open --profile=/abs/path` uses an explicit directory, which is how one identity is shared across workspaces.
- `open --isolated` uses an in-memory profile: nothing survives `close`, and every open is a new identity.

## The identity file

`<profile>/patchright-cli.json`:

```json
{
  "version": 1,
  "createdAt": "2026-09-05T10:00:00.000Z",
  "updatedAt": "2026-09-05T12:30:00.000Z",
  "channel": "chrome",
  "os": "win32 10.0.28000",
  "locale": "de-DE",
  "timezone": "Europe/Berlin",
  "geo": { "ip": "1.2.3.4", "countryCode": "DE", "timezone": "Europe/Berlin", "latitude": 52.52, "longitude": 13.4, "lookedUpAt": "...", "source": "ipinfo.io" }
}
```

| field | lifecycle |
|---|---|
| `createdAt`, `os` | frozen at the first open |
| `channel` | frozen; reopening with another channel warns (`channel-changed`) because the same cookies now present a different browser |
| `locale`, `timezone`, `geo` | refreshed on every open that derives or sets them |
| proxy server, credentials | never stored |

A separate `<session>.state.json` next to the session file holds client-side runtime state (humanize on/off, last pointer position); it is reset on every open.

## Lifecycle

```bash
patchright-cli -s=acme open https://acme.example --proxy=http://...   # creates the identity
patchright-cli -s=acme identity                                        # inspect
patchright-cli -s=acme close                                           # profile and identity stay
patchright-cli -s=acme open https://acme.example --proxy=http://...   # same identity, refreshed geo
patchright-cli -s=acme delete-data                                     # profile gone: a new identity next time
```

## Parallel identities

Each session name is a separate Chrome with a separate profile and separate warnings. Tabs inside one session share the identity; use tabs for parallel pages of the same user, sessions for different users.

```bash
patchright-cli -s=buyer open https://shop.example --proxy=http://buyer.proxy:3128
patchright-cli -s=seller open https://shop.example --proxy=http://seller.proxy:3128
```

## What burns an identity

- Switching proxies (countries) inside one session, or `--no-geoip` with a foreign proxy.
- Flipping between headed and headless, `--device` or a fixed viewport on a profile that was used bare.
- `state-load` of another identity's cookies into this profile.
- A brand-new profile on every login (`--isolated`) for accounts that should look established.
- Solving challenges in a loop; each failed attempt lowers the reputation of both the IP and the identity.

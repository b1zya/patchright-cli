# Contributing

## Setup

```bash
git clone https://github.com/b1zya/patchright-cli.git
cd patchright-cli
npm ci
npm run build
npm run check
npm test
```

Google Chrome (or Edge) must be installed. The `unit` and `integration` projects run headless and need no display (the integration project is the headless verification: launch, navigate, read content, exit). The `stealth` project launches Chrome headed; on Linux without a display: `xvfb-run -a npm run test:stealth`.

## Layout and rules

Read [CLAUDE.md](CLAUDE.md): repo map, the provenance rule for `src/` (forked from playwright-cli, ported on every roll, never patched in `node_modules`), the commit convention and the stealth rules.

## Pull request checklist

- `npm run check` and `npm test` pass locally.
- A new command or flag has a help overlay entry, a guard decision, a line in `skills/patchright-cli/SKILL.md` and a test.
- A new default that changes what the page can observe has a `LeakWarning` and a test.
- `node bin/patchright-cli.js selftest` still passes; paste the summary line in the PR.
- `CHANGELOG.md` has a line under Unreleased.

## Rolling patchright-core

See [.claude/skills/dev/roll.md](.claude/skills/dev/roll.md): `npm run roll -- <version> --dry-run` prints the porting checklist; the pin is exact because patchright has no `next` tag and lags Playwright minors.

## Releasing

See [.claude/skills/dev/release.md](.claude/skills/dev/release.md): a GitHub release with the tarball attached; nothing is published to npm.

## Conduct

Be direct and kind. Report abuse to the maintainers through GitHub.

## Upstream updates

`vendor/` holds the pristine sources every forked file came from and is never edited by hand; `src/` is this project's layer. `npm run roll -- <version>` merges a newer `patchright-core` through it (three-way, stops on conflicts), `npm run roll -- <version> --dry-run` only reports, `npm run watch:playwright-cli` does the same for `microsoft/playwright-cli`, and `scripts/upstream-snapshot/versions.json` records the versions the checkout is based on. The daily/weekly workflows in `.github/workflows/upstream-*.yml` roll on a branch, run CI and open the PR; only a roll that changed nothing we fork from is merged automatically. Details: `.claude/skills/dev/roll.md`.

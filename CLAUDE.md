# patchright-cli — agent notes

Anti-detection browser CLI for AI agents: our TypeScript client (forked from playwright-cli) in front of the untouched `patchright-core` daemon. Non-goals: Firefox/WebKit, npm publishing, a browser-backend abstraction, console capture.

## Repo map

- `src/` — the client. `program.ts session.ts registry.ts output.ts channelSessions.ts args.ts(minimist) socketConnection.ts cli.ts` keep upstream file names 1:1. `core.ts paths.ts daemonEnv.ts` locate patchright-core and isolate our state. `config/` merges user config into the generated daemon config. `stealth/` is the anti-detection layer (launch profile, guards, warnings, proxy, geo, identity). `humanize/` is the pointer/typing layer. `commands/` are client-side commands. `help/help.generated.json` is generated.
- `skills/patchright-cli/` — the agent skill, hand-maintained; the contract lives there.
- `scripts/` — `build.mjs`, `sync-help.ts`, `check-drift.ts`, `validate-skill.ts` (every command line in the skill parses against the CLI; frontmatter; vendor-neutral wording), `roll.ts`, `watch-playwright-cli.ts`, `upstream-patch.ts`, `upstream/lib.ts` (the upstream layer: version matching, three-way merge, verdicts), `session-check.mjs` (silent session-start check), `upstream-snapshot/` (`versions.json`, compiled snapshot, `client.patch`).
- `vendor/` — pristine upstream sources the forked files are merged through (`cli-client/` from Playwright at the recorded tag, `playwright-cli/` from microsoft/playwright-cli); never edit.
- `tests/unit` (no browser), `tests/integration` (spawns the CLI), `tests/stealth` (real headed Chrome).

## Provenance rule

`src/*.ts` were forked from the Playwright client sources; the pristine copies live in `vendor/cli-client/` (Playwright `v1.62.1`, the tag whose compiled client is byte-identical to `patchright-core@1.62.3`) and `vendor/playwright-cli/` (the file we still carry from `microsoft/playwright-cli`). `vendor/` is never edited by hand: a roll (`npm run roll -- <version>`) three-way merges upstream changes into `src/` through it and stops on conflicts instead of overwriting either side; `scripts/upstream-snapshot/versions.json` records the versions, `client.patch` there is our layer as a readable diff. Never edit `node_modules/patchright-core`; keep upstream file names so merges stay readable. `npm run check` fails on drift (compiled snapshot, generated help, `versions.json`, vendored hashes). The procedure and the CI automation are in `.claude/skills/dev/roll.md`.

## Build and test

```bash
npm ci
npm run build            # esbuild -> lib/cli.js
npm run check            # typecheck + help sync + upstream drift
npm test                 # all projects; the stealth project needs a display (Linux: xvfb-run -a)
npm run test:unit
node bin/patchright-cli.js selftest
```

## Commit convention

Semantic commit messages: `label(scope): description`. Labels: `fix`, `feat`, `chore`, `docs`, `test`, `devops`; scopes such as `stealth`, `humanize`, `config`, `skill`. Branches: `fix-<issue>`, `feat-<slug>`, `roll_<version>`, `mark-v<version>`. Never add Co-Authored-By agents in commit messages.

## Stealth rules

- Never introduce `Runtime.enable`, `Page.addScriptToEvaluateOnNewDocument`, `--enable-automation`, `--no-sandbox` or main-world prototype patching.
- `open` is headless by default; headed is opt-in (`--headed`). The precedence is `resolveBrowserMode` in `src/stealth/launchProfile.ts` (flag > config > display > default) and display detection is `detectDisplay` in `src/commands/env.ts`. `--headed` without a display stays a clear, platform-specific error, never a silent downgrade; the `headless` warning fires only with `--proxy`.
- A new default that touches emulation ships with a `LeakWarning` (`src/stealth/warnings.ts`) and a test.
- A new command ships with a help overlay entry (`src/stealth/flags.ts`), a guard decision (`src/stealth/guards.ts`) and a line in `skills/patchright-cli/SKILL.md`; the docs tests enforce it.
- The `PWTEST_*` environment hooks in `src/daemonEnv.ts` are load-bearing: they are how the daemon is pointed at our state directories.
- `skills/patchright-cli/` is the source of truth for agent-facing docs; README mirrors it.
- The skill is agent-agnostic: plain Markdown, standard frontmatter, no vendor names (the docs tests and `scripts/validate-skill.ts`, part of `npm run check`, enforce this). Anything that depends on the user's machine (shell quoting, console encoding, display, locale) belongs in `patchright-cli env` and its rules, so agents adapt at runtime instead of the docs guessing.

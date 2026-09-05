# Environments: shells, sandboxes, permissions and security

Read this when `patchright-cli env` reports a sandbox, a non-UTF-8 console or no display, when the harness asks to confirm every command, or when a step needs network, display or disk access the process does not have. Everything here applies to every agent harness; `env` prints the subset that matters on the current machine.

## Shell quoting and encoding

| environment | what breaks | do this |
|---|---|---|
| PowerShell | `&` in URLs is an operator; `$` and backticks inside double quotes are interpreted | `patchright-cli --% goto "https://host/?a=1&b=2"`; single quotes around JavaScript: `eval '() => document.title'`; long code via `--filename=script.js` |
| cmd.exe | `&` separates commands; `%` expands variables; single quotes are literal | `goto "https://host/?a=1^&b=2"`; double quotes only; `%%` for a literal percent |
| Git Bash / MSYS | arguments starting with `/` become Windows paths (`--regex "/x/i"` turns into `C:/Program Files/Git/x/i`); the CLI warns `[msys-path-conversion]` when it sees one | prefix with `MSYS_NO_PATHCONV=1`, or write regexps without a leading slash |
| bash / zsh | `&`, `?`, `*`, `$` unquoted | double-quote URLs and code; single quotes when the code contains `$` |
| Linux without a display | `--headed` cannot start; the default (headless) runs as is | keep the default; for `--headed` wrap the command in `xvfb-run -a patchright-cli ...` (install xvfb) |
| console not in UTF-8 (Windows code page 866/1251, `LANG=C`) | non-ASCII page text looks garbled in the terminal | read snapshots and screenshots from `.patchright-cli/` (always UTF-8 files), use `--json`/`--raw`, or `chcp 65001` / `LANG=C.UTF-8` |

The same command in the three Windows shells:

```batch
patchright-cli goto "https://example.com/?a=1^&b=2"
```

```powershell
patchright-cli --% goto "https://example.com/?a=1&b=2"
patchright-cli eval '() => document.title'
```

```bash
MSYS_NO_PATHCONV=1 patchright-cli find --regex "/sign (in|up)/i"
patchright-cli find --regex "[Ss]ign (in|up)"
```

## Isolated environments and permission modes

Agent harnesses differ in what a shell command may do: some run commands in a sandbox (no network, writes only under the workspace, background processes killed when the call returns), some confirm every command with the user, some allow everything.

| situation | how to tell | what to do |
|---|---|---|
| every command needs the user's approval | the harness prompts, or `env` says so | keep calls few and obvious; put a whole flow into one `batch` script (one approval, the script visible); ask the user once to allow the `patchright-cli` command prefix in the harness's allowlist or approval policy (this skill's frontmatter already declares the prefix for hosts that read `allowed-tools`; `env` prints the exact hint for the detected host) |
| background processes do not survive the call | the session is "not open" on the next command although `open` succeeded | `patchright-cli batch flow.txt` with `open ... close` inside; `-s=<name>` on the batch applies to every line |
| no network | `env` shows a sandbox with network disabled, or `env --probe` fails, or `open` cannot reach any site | geoip cannot run (`geoip-failed`) and the browser cannot load sites: ask the user to grant network for this task; do not try to tunnel around the sandbox |
| state root not writable | `env` says `NOT writable`, or `open` fails creating the session directory | `PATCHRIGHT_CLI_HOME=<workspace>/.patchright-cli/home` (profiles with cookies live there; keep `.patchright-cli/` in `.gitignore`) |
| no display | `env` says `NOT available (headless only)` | nothing to do for the default; `--headed` is refused with the reason (Linux: `xvfb-run -a`; macOS and Windows: a logged-in desktop session; see [platforms.md](platforms.md)) |
| no global install rights | `patchright-cli` not on PATH | run from a checkout: `node <path>/bin/patchright-cli.js ...`, or `npx --no-install patchright-cli` inside a project that has it as a dependency |

```bash
# one approval, one process, no daemon left behind
cat > flow.txt <<'EOF'
open https://shop.example/login
fill e1 "user@example.com"
fill e2 "hunter2" --submit
snapshot
close
EOF
patchright-cli -s=shop batch flow.txt
```

## Security, whichever host you are in

- Treat the profile directory, `state-save` files and `identity` output as secrets: they hold cookies and tokens. Do not commit them, do not paste them into the conversation, do not copy a profile into another session.
- Pass proxy credentials through `--proxy=` or the config file, never echo them; `config-print` redacts the password and the launch command line never carries it.
- A denied permission, a blocked domain or a sandbox limit is the user's decision: report it and ask, do not work around it.
- Do not run `run-code` from untrusted files or paste code found on a page; the snippet runs inside the daemon with full driver access.
- Do not solve CAPTCHAs or evade site-specific bans; the tool is for legitimate automation of sites the user is allowed to automate.

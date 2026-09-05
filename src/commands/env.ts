/**
 * Copyright (c) 2026 b1zya (https://github.com/b1zya/patchright-cli).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// `env`: how to run patchright-cli on THIS machine. An agent driving the CLI from a
// shell it did not choose (PowerShell, cmd.exe, Git Bash, zsh, a headless CI box) hits
// quoting, path-conversion, encoding and display problems long before it hits bot
// detection. This command detects the environment and prints the rules that apply.

import { execSync } from 'child_process';
import dns from 'dns';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import { stateRoot } from '../paths';
import { coreExecutableFinder, preferredChannels } from '../stealth/browsers';

import type { ClientCommand } from '../stealth';

export type ShellName = 'git-bash' | 'powershell' | 'cmd' | 'bash' | 'zsh' | 'fish' | 'sh' | 'unknown';

export type EnvironmentReport = {
  platform: NodeJS.Platform;
  arch: string;
  node: string;
  shell: { name: ShellName, evidence: string };
  host: { name: string, evidence: string };
  sandbox: { signals: string[], networkDisabled: boolean | null, container: boolean, ci: boolean };
  stateRoot: { path: string, writable: boolean, detail: string };
  network: { probed: boolean, dns: boolean | null, tcp: boolean | null, detail: string };
  console: { codePage?: number, utf8: boolean, detail: string };
  locale: { language: string, timezone: string, detail: string };
  display: { available: boolean, humanVisible: boolean, detail: string };
  browser: { channel: string, executablePath: string } | null;
  rules: string[];
  recommendations: { key: string, message: string }[];
};

export type EnvDeps = {
  platform: NodeJS.Platform;
  arch: string;
  env: NodeJS.ProcessEnv;
  nodeVersion: string;
  codePage: () => number | undefined;
  find: (name: string) => string | undefined;
  intl: () => { locale: string, timeZone: string };
  stateRoot: () => string;
  isWritable: (dir: string) => boolean;
  isContainer: () => boolean;
  probe?: () => Promise<{ dns: boolean, tcp: boolean }>;
};

// Which agent harness is driving us, from the markers those harnesses put in the
// environment. Only used to word the rules; every rule applies regardless.
export function detectHost(env: NodeJS.ProcessEnv): { name: string, evidence: string } {
  const markers: [string, string][] = [
    ['CODEX_SANDBOX', 'Codex CLI'],
    ['CODEX_SANDBOX_NETWORK_DISABLED', 'Codex CLI'],
    ['CODEX_CI', 'Codex'],
    ['CLAUDECODE', 'Claude Code'],
    ['CLAUDE_CODE', 'Claude Code'],
    ['COPILOT_CLI', 'GitHub Copilot CLI'],
    ['CURSOR_AGENT', 'Cursor'],
    ['GEMINI_CLI', 'Gemini CLI'],
    ['AIDER_MODEL', 'Aider'],
  ];
  for (const [key, name] of markers) {
    if (env[key])
      return { name, evidence: `${key}=${env[key]}` };
  }
  if (env.TERM_PROGRAM)
    return { name: `terminal (${env.TERM_PROGRAM})`, evidence: `TERM_PROGRAM=${env.TERM_PROGRAM}` };
  return { name: 'unknown', evidence: 'no agent markers in the environment' };
}

export function detectSandbox(env: NodeJS.ProcessEnv, container: boolean): EnvironmentReport['sandbox'] {
  const signals: string[] = [];
  let networkDisabled: boolean | null = null;
  if (env.CODEX_SANDBOX) {
    signals.push(`Codex sandbox (${env.CODEX_SANDBOX})`);
  }
  if (env.CODEX_SANDBOX_NETWORK_DISABLED === '1' || env.CODEX_SANDBOX_NETWORK_DISABLED === 'true') {
    signals.push('network disabled by the Codex sandbox');
    networkDisabled = true;
  }
  if (env.CLAUDE_CODE_SANDBOX || env.SANDBOX)
    signals.push(`sandbox flag (${env.CLAUDE_CODE_SANDBOX ? 'CLAUDE_CODE_SANDBOX' : 'SANDBOX'})`);
  const ci = !!(env.CI || env.GITHUB_ACTIONS || env.GITLAB_CI || env.BUILDKITE || env.TF_BUILD || env.JENKINS_URL);
  if (ci)
    signals.push('CI runner');
  if (container)
    signals.push('container');
  if (env.KUBERNETES_SERVICE_HOST)
    signals.push('kubernetes pod');
  return { signals, networkDisabled, container, ci };
}

export function detectShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { name: ShellName, evidence: string } {
  if (env.MSYSTEM)
    return { name: 'git-bash', evidence: `MSYSTEM=${env.MSYSTEM}` };
  if (platform === 'win32') {
    if (env.PROMPT && !env.PSModulePath)
      return { name: 'cmd', evidence: 'PROMPT is set' };
    if (env.PSModulePath)
      return { name: env.PROMPT ? 'powershell' : 'powershell', evidence: env.PROMPT ? 'PSModulePath and PROMPT set (PowerShell started from cmd, or cmd from PowerShell)' : 'PSModulePath is set' };
    return { name: 'unknown', evidence: 'no shell markers in the environment' };
  }
  const shell = env.SHELL ?? '';
  const base = shell.split('/').pop() ?? '';
  if (base === 'bash' || base === 'zsh' || base === 'fish' || base === 'sh')
    return { name: base, evidence: `SHELL=${shell}` };
  return { name: shell ? 'unknown' : 'sh', evidence: shell ? `SHELL=${shell}` : 'SHELL is not set' };
}

// Whether a headed browser has a screen to draw on, and whether a person could see it.
// This is the environment leg of the mode-selection policy (see stealth/launchProfile.ts):
//   - Linux: a headed browser needs an X11 or Wayland display; without one Chrome cannot
//     start unless it is wrapped in a virtual display (xvfb-run).
//   - macOS: a window is drawn by the Aqua window server, which exists only in an interactive
//     login (GUI) session. From the environment alone this is a heuristic: an SSH shell has
//     no window server for its login; a process started from a GUI application (Terminal,
//     an IDE, an agent app) carries LaunchServices/terminal markers; otherwise a GUI session
//     is assumed. `launchctl managername` (Aqua vs Background) is the definitive check.
//     There is no macOS equivalent of Xvfb.
//   - Windows: the interactive desktop of a logged-in session. An OpenSSH shell or a
//     service (session 0) has no interactive desktop for a window.
// `available` answers "can a headed browser draw?"; `humanVisible` answers "would a person
// see it?" (a virtual display is available but not human-visible).
export function detectDisplay(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { available: boolean, humanVisible: boolean, detail: string } {
  if (platform === 'linux') {
    const available = !!(env.DISPLAY || env.WAYLAND_DISPLAY);
    if (!available)
      return { available: false, humanVisible: false, detail: 'no DISPLAY or WAYLAND_DISPLAY' };
    // xvfb-run exports an XAUTHORITY under its own temp dir. An Xvfb started by hand is
    // indistinguishable from a real screen in the environment and counts as visible.
    const virtual = /xvfb/i.test(env.XAUTHORITY ?? '');
    return { available: true, humanVisible: !virtual, detail: `DISPLAY=${env.DISPLAY ?? ''} WAYLAND_DISPLAY=${env.WAYLAND_DISPLAY ?? ''}${virtual ? ' (virtual: xvfb-run)' : ''}`.trim() };
  }
  if (platform === 'darwin') {
    if (env.SSH_CONNECTION || env.SSH_TTY || env.SSH_CLIENT)
      return { available: false, humanVisible: false, detail: 'SSH session: no Aqua window server for this login; macOS has no Xvfb equivalent' };
    const marker = ['__CFBundleIdentifier', 'TERM_PROGRAM', 'Apple_PubSub_Socket_Render'].find(key => env[key]);
    if (marker)
      return { available: true, humanVisible: true, detail: `macOS GUI session (${marker}=${env[marker]})` };
    return { available: true, humanVisible: true, detail: 'macOS (interactive session assumed: no SSH markers; `launchctl managername` prints Aqua in a GUI session)' };
  }
  // win32: SESSIONNAME is unset in many interactive shells too, so only clear negatives count.
  const remote = !!(env.SSH_CONNECTION || env.SSH_TTY);
  if (remote)
    return { available: false, humanVisible: false, detail: 'OpenSSH session on Windows: no interactive desktop for a window' };
  if (env.SESSIONNAME === 'Services')
    return { available: false, humanVisible: false, detail: 'Windows service session (session 0): no interactive desktop' };
  return { available: true, humanVisible: true, detail: 'Windows interactive desktop session' };
}

export function windowsCodePage(): number | undefined {
  try {
    const output = execSync('chcp', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 3000 });
    const match = output.match(/(\d{3,5})/);
    return match ? Number(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

export async function buildEnvironmentReport(deps: EnvDeps): Promise<EnvironmentReport> {
  const { platform, env } = deps;
  const shell = detectShell(platform, env);
  const host = detectHost(env);
  const sandbox = detectSandbox(env, deps.isContainer());
  const rules: string[] = [];
  const recommendations: { key: string, message: string }[] = [];

  // State root: sessions, profiles and sockets must be writable. Sandboxes often allow
  // writes only under the workspace.
  const rootPath = deps.stateRoot();
  const writable = deps.isWritable(rootPath);
  const stateRoot = { path: rootPath, writable, detail: writable ? 'writable' : 'NOT writable' };
  if (!writable)
    recommendations.push({ key: 'state-root', message: `The state root ${rootPath} is not writable here. Point it at the workspace before the first open: PATCHRIGHT_CLI_HOME=<workspace>/.patchright-cli/home (add it to .gitignore; it will hold profiles with cookies).` });

  // Network: only probed on request, so that a sandbox with a permission prompt is not
  // poked without the agent deciding to.
  let network: EnvironmentReport['network'] = { probed: false, dns: null, tcp: null, detail: sandbox.networkDisabled ? 'disabled by the sandbox (no probe needed)' : 'not probed; run `env --probe` when network access is allowed' };
  if (deps.probe && !sandbox.networkDisabled) {
    const result = await deps.probe();
    network = { probed: true, dns: result.dns, tcp: result.tcp, detail: `dns ${result.dns ? 'ok' : 'FAILED'}, tcp ${result.tcp ? 'ok' : 'FAILED'}` };
  }
  const offline = sandbox.networkDisabled === true || (network.probed && !network.dns && !network.tcp);
  if (offline)
    recommendations.push({ key: 'no-network', message: 'No network from this process: geoip lookups will fail (warning geoip-failed) and the browser cannot reach sites unless the sandbox grants network access to it. Ask the user to enable network for this task instead of working around the sandbox.' });

  // Console encoding.
  let consoleInfo: EnvironmentReport['console'];
  if (platform === 'win32') {
    const codePage = deps.codePage();
    const utf8 = codePage === 65001;
    consoleInfo = { codePage, utf8, detail: codePage ? `active code page ${codePage}${utf8 ? ' (UTF-8)' : ' (not UTF-8)'}` : 'code page unknown' };
    if (codePage && !utf8)
      recommendations.push({ key: 'console-encoding', message: `The console code page is ${codePage}, not UTF-8: non-ASCII page text can look garbled when printed. Prefer --json/--raw and read snapshots and screenshots from the output directory (they are UTF-8 files), or run \`chcp 65001\` once in this console.` });
  } else {
    const lang = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
    const utf8 = /utf-?8/i.test(lang);
    consoleInfo = { utf8, detail: lang ? `${lang}${utf8 ? '' : ' (not UTF-8)'}` : 'LANG not set (C locale)' };
    if (!utf8)
      recommendations.push({ key: 'console-encoding', message: `The locale is '${lang || 'C'}', not UTF-8: set LANG=C.UTF-8 (or another UTF-8 locale) so non-ASCII page text survives the terminal, or rely on --json and the output files.` });
  }

  // Host locale and timezone: what pages see unless a proxy or flags change them.
  const intl = deps.intl();
  const locale = { language: intl.locale, timezone: intl.timeZone, detail: `pages see ${intl.locale} / ${intl.timeZone} unless --proxy (geoip), --locale or --timezone change them` };

  // Display: can a headed browser draw here, and would a person see it?
  const display = detectDisplay(platform, env);
  if (!display.available && platform === 'linux')
    recommendations.push({ key: 'no-display', message: 'No display: `--headed` cannot start here. The default (headless) works as is; only add `--headed` for interactive login, CAPTCHAs or debugging you must watch, and then wrap the command in `xvfb-run -a patchright-cli ...` (install xvfb) or run it on a machine with a screen.' });
  else if (!display.available)
    recommendations.push({ key: 'no-display', message: `No interactive GUI session (${display.detail}): \`--headed\` cannot open a visible window and will report the limitation. The default (headless) works as is; run headed tasks from a logged-in desktop session.` });

  // Browser.
  let browser: EnvironmentReport['browser'] = null;
  for (const channel of preferredChannels) {
    const executablePath = deps.find(channel);
    if (executablePath) {
      browser = { channel, executablePath };
      break;
    }
  }
  if (!browser)
    recommendations.push({ key: 'no-browser', message: 'No Chromium-based browser found: install Google Chrome or Microsoft Edge, or `patchright-cli install-browser chromium` (detectable fallback).' });
  else if (browser.channel === 'chromium')
    recommendations.push({ key: 'bundled-chromium', message: 'Only the bundled Chromium is available; it is detectable. Install Google Chrome or Microsoft Edge.' });

  // Shell rules.
  switch (shell.name) {
    case 'git-bash':
      rules.push(
          'Git Bash rewrites arguments that start with "/" into Windows paths: prefix the command with MSYS_NO_PATHCONV=1 for `find --regex "/.../i"`, XPath selectors and any argument beginning with a slash.',
          'Quote arguments with double quotes; `&` inside quotes is safe. Use `$(...)` and pipes as in bash.',
          'Paths for --filename, --profile and --config may use forward slashes; C:/... is fine.',
      );
      break;
    case 'powershell':
      rules.push(
          'PowerShell treats `&` as an operator: for URLs with several query parameters run `patchright-cli --% goto "https://host/?a=1&b=2"` (stop-parsing token) or wrap the URL in single quotes.',
          'Inside double quotes `$` is interpolated and backtick is the escape character; use single quotes for JavaScript passed to eval/run-code, or --filename=script.js for anything longer than a line.',
          'Nested quotes: `\'() => document.title\'` for eval; double-double quotes ("") escape a double quote inside a double-quoted string.',
      );
      break;
    case 'cmd':
      rules.push(
          'cmd.exe treats `&` as a command separator: escape it as `^&` inside URLs, e.g. `patchright-cli goto "https://host/?a=1^&b=2"`.',
          'Only double quotes group arguments; single quotes are literal. For JavaScript with quotes use --filename=script.js.',
          'Percent signs in arguments are expanded as variables; double them (%%) when they must be literal.',
      );
      break;
    default:
      rules.push(
          'POSIX shell: double-quote URLs and JavaScript so `&`, `?`, `*`, `$` and spaces are not interpreted; single quotes when the argument itself contains `$`.',
          'Run long snippets from a file with --filename=script.js.',
      );
  }
  rules.push('Prefer `--raw` for values you parse and `--json` for structured output; snapshots, screenshots and traces are files under the output directory (.patchright-cli/), always UTF-8, and are the most reliable way to read page content.');
  if (platform === 'win32')
    rules.push('Use forward slashes or quoted backslashes in paths; the daemon and the browser accept both.');

  // Permission modes and sandboxes: every CLI call may be a tool call the user has to
  // approve, and a sandbox may not keep the daemon alive between calls.
  const allowlistHint = host.name === 'Claude Code'
    ? 'In Claude Code, `Bash(patchright-cli:*)` in the allowed tools (the skill frontmatter declares it; the user can add it under permissions) lets the calls run without a prompt each time.'
    : host.name.startsWith('Codex')
      ? 'In Codex, the approval policy decides whether each command is confirmed; a `batch` script is one approval for the whole flow.'
      : 'If the harness confirms each shell command, ask the user once to allow the `patchright-cli` prefix; otherwise keep the number of calls small.';
  rules.push(`Permissions: ${allowlistHint} Never work around a denied permission or a sandbox; report what was denied and ask.`);
  rules.push('Isolated runs: when background processes do not survive between tool calls (sandboxes, some CI steps), put the whole flow in one call with `patchright-cli batch script.txt` (open ... commands ... close), and keep state under the workspace with PATCHRIGHT_CLI_HOME.');
  if (host.name !== 'unknown' && !host.name.startsWith('terminal'))
    rules.push('Session lifetime: an agent that finishes rarely comes back to `close`, so here `open` closes the browser after 30 min without a command, or as soon as the agent process (CLAUDE_PID / PATCHRIGHT_CLI_OWNER_PID) exits. `--idle-timeout=2h` or `--idle-timeout=0` and `--no-owner-pid` change that; the profile stays, so the next `open` is still logged in. Still `close` when a task is done.');
  if (!display.available) {
    rules.push('Mode: `open` runs headless by default and works here. `--headed` cannot open a visible window in this environment (no interactive display); it reports the limitation rather than failing obscurely. Run headed-only tasks from a machine with a screen.');
  } else {
    const headedNote = display.humanVisible
      ? 'a display is available, so add `--headed` when the task needs it'
      : 'the display here is virtual (not human-visible), so `--headed` renders but nobody watches it — add it only when a step still needs a real GUI';
    rules.push('Mode: `open` runs headless by default (no window; works on servers and in isolation); ' + headedNote + ' for interactive login, CAPTCHAs, manual inspection, debugging you must watch, or a site that blocks headless. Do not add `--headed` just for stealth; pick the least intrusive mode the task allows.');
  }
  if (sandbox.signals.length)
    rules.push(`Detected: ${sandbox.signals.join(', ')}. Expect no network unless granted, no display unless provided (xvfb), and writes only under the workspace.`);

  return {
    platform,
    arch: deps.arch,
    node: deps.nodeVersion,
    shell,
    host,
    sandbox,
    stateRoot,
    network,
    console: consoleInfo,
    locale,
    display,
    browser,
    rules,
    recommendations,
  };
}

export function renderEnvironmentReport(report: EnvironmentReport): string {
  const lines = [
    '### patchright-cli environment',
    `- platform: ${report.platform} ${report.arch}, node ${report.node}`,
    `- shell: ${report.shell.name} (${report.shell.evidence})`,
    `- agent host: ${report.host.name} (${report.host.evidence})`,
    `- sandbox: ${report.sandbox.signals.length ? report.sandbox.signals.join(', ') : 'no sandbox markers'}`,
    `- state root: ${report.stateRoot.path} (${report.stateRoot.detail})`,
    `- network: ${report.network.detail}`,
    `- console: ${report.console.detail}`,
    `- host locale/timezone: ${report.locale.language} / ${report.locale.timezone}`,
    `- display: ${report.display.available ? (report.display.humanVisible ? 'available' : 'available, not human-visible') : 'NOT available (headless only)'} (${report.display.detail})`,
    `- browser: ${report.browser ? `${report.browser.channel} at ${report.browser.executablePath}` : '(none found)'}`,
    '',
    '### How to run commands here',
    ...report.rules.map(rule => `- ${rule}`),
  ];
  if (report.recommendations.length) {
    lines.push('', '### Fix before relying on the output');
    lines.push(...report.recommendations.map(r => `- [${r.key}] ${r.message}`));
  }
  return lines.join('\n');
}

export function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function isContainer(): boolean {
  if (process.platform !== 'linux')
    return false;
  try {
    if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv'))
      return true;
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    return /docker|containerd|lxc|kubepods|podman/i.test(cgroup);
  } catch {
    return false;
  }
}

// Two cheap checks with short timeouts: a DNS lookup and a TCP connect to a public
// resolver. Both failing means this process has no network at all.
export async function probeNetwork(timeoutMs = 2000): Promise<{ dns: boolean, tcp: boolean }> {
  const dnsOk = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    dns.lookup('example.com', err => {
      clearTimeout(timer);
      resolve(!err);
    });
  });
  const tcpOk = await new Promise<boolean>(resolve => {
    const socket = net.createConnection({ host: '1.1.1.1', port: 443 });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
  return { dns: dnsOk, tcp: tcpOk };
}

export function collectEnvironmentReport(options: { probe?: boolean } = {}): Promise<EnvironmentReport> {
  const find = coreExecutableFinder();
  return buildEnvironmentReport({
    platform: process.platform,
    arch: os.arch(),
    env: process.env,
    nodeVersion: process.version,
    codePage: windowsCodePage,
    find: name => find(name),
    intl: () => {
      const options = Intl.DateTimeFormat().resolvedOptions();
      return { locale: options.locale, timeZone: options.timeZone };
    },
    stateRoot,
    isWritable: isWritableDir,
    isContainer,
    probe: options.probe ? () => probeNetwork() : undefined,
  });
}

export const envCommand: ClientCommand = {
  name: 'env',
  async run(ctx) {
    const report = await collectEnvironmentReport({ probe: ctx.args.probe === true });
    ctx.output.toolResult(ctx.output.json ? JSON.stringify(report, null, 2) : renderEnvironmentReport(report));
  },
};

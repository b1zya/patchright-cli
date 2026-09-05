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

// Flags and commands that exist only on the client. The help overlay documents them and
// the parser accepts them; they are consumed here and never forwarded to the daemon.

export type FlagType = 'boolean' | 'string';

export type ClientFlag = {
  command: string;
  name: string;
  type: FlagType;
  help: string;
};

export type ClientCommandSpec = {
  name: string;
  section: string;
  usage: string;
  description: string;
  args?: { name: string, help: string }[];
  flags?: { name: string, type: FlagType, help: string }[];
};

export const clientFlags: ClientFlag[] = [
  { command: 'open', name: 'headless', type: 'boolean', help: 'force headless (no window); already the default. use --headed for a visible window' },
  { command: 'open', name: 'headless-user-agent', type: 'boolean', help: 'headless only: present the headed user agent of the same chrome build instead of HeadlessChrome (default on); --no-headless-user-agent keeps the raw one' },
  { command: 'open', name: 'isolated', type: 'boolean', help: 'use a throwaway in-memory profile instead of the persistent per-session profile' },
  { command: 'open', name: 'proxy', type: 'string', help: 'proxy url, e.g. http://user:pass@host:port (socks5 only without credentials)' },
  { command: 'open', name: 'proxy-bypass', type: 'string', help: 'comma-separated hosts that bypass the proxy' },
  { command: 'open', name: 'geoip', type: 'boolean', help: 'derive timezone, language and geolocation from the exit ip; on by default with --proxy, --no-geoip disables' },
  { command: 'open', name: 'locale', type: 'string', help: 'browser locale, e.g. de-DE (overrides the geoip value)' },
  { command: 'open', name: 'timezone', type: 'string', help: 'iana timezone, e.g. Europe/Berlin (overrides the geoip value)' },
  { command: 'open', name: 'grant', type: 'string', help: 'comma-separated permissions to grant to every origin, e.g. geolocation' },
  { command: 'open', name: 'window-size', type: 'string', help: 'window size as WxH instead of a maximized window' },
  { command: 'open', name: 'extra-arg', type: 'string', help: 'additional chromium switch (repeatable, not vetted)' },
  { command: 'open', name: 'focus-emulation', type: 'boolean', help: 'pass --no-focus-emulation to let pages observe the real window focus' },
  { command: 'open', name: 'humanize', type: 'boolean', help: 'human-like mouse paths and typing cadence for this session' },
  ...['open', 'attach'].flatMap(command => [
    { command, name: 'idle-timeout', type: 'string' as FlagType, help: 'close the browser after this long without a command (30m, 2h, 90s; 0 keeps it open). default: 30m inside an agent harness, never otherwise' },
    { command, name: 'owner-pid', type: 'string' as FlagType, help: 'close the browser when this process exits; defaults to PATCHRIGHT_CLI_OWNER_PID or CLAUDE_PID when set and alive, --no-owner-pid disables' },
  ]),
  { command: 'eval', name: 'main-world', type: 'boolean', help: 'evaluate in the page main world: sees page globals, but is observable by the page' },
  { command: 'run-code', name: 'force', type: 'boolean', help: 'run code the safety scan would refuse (Runtime.enable is never allowed)' },
  ...['click', 'dblclick', 'hover', 'drag', 'mousemove', 'mousewheel', 'type', 'fill'].map(command => ({
    command,
    name: 'humanize',
    type: 'boolean' as FlagType,
    help: 'human-like pointer path and cadence for this command (--no-humanize to force the instant tool); defaults to the session setting',
  })),
];

export const clientCommands: ClientCommandSpec[] = [
  {
    name: 'env',
    section: 'Stealth',
    usage: 'env',
    description: 'Show how to run commands on this system: shell quoting rules, agent host and sandbox markers, writable state root, console encoding, display, host locale and timezone, default browser.',
    flags: [
      { name: 'probe', type: 'boolean', help: 'also probe network access (dns lookup + tcp connect, 2s timeouts); only when the sandbox allows it' },
    ],
  },
  {
    name: 'batch',
    section: 'Stealth',
    usage: 'batch [file]',
    description: 'Run a whole flow from a script in one invocation (one command per line, # comments; "-" or no file reads stdin). For sandboxes that kill background processes between tool calls and for permission modes that confirm every command.',
    args: [{ name: '[file]', help: 'script file with one patchright-cli command per line; the script should end with close' }],
    flags: [
      { name: 'continue-on-error', type: 'boolean', help: 'keep running after a failing command instead of stopping' },
    ],
  },
  {
    name: 'wait-for-user',
    section: 'Stealth',
    usage: 'wait-for-user [seconds]',
    description: 'Hand the visible browser window to the user (password, one-time code, consent dialog) and wait until the page navigates or the time runs out (default 300s), then take a fresh snapshot.',
    args: [{ name: '[seconds]', help: 'how long to wait for the page to change; defaults to 300' }],
  },
  {
    name: 'identity',
    section: 'Stealth',
    usage: 'identity',
    description: 'Show the identity of the session profile: browser channel, locale, timezone and geo it was last opened with.',
  },
  {
    name: 'doctor',
    section: 'Stealth',
    usage: 'doctor',
    description: 'Check the environment: installed browsers, versions, state directories and leftover upstream CLI configuration.',
  },
  {
    name: 'selftest',
    section: 'Stealth',
    usage: 'selftest',
    description: 'Run the detection self-test in a throwaway session: automation markers, tampering, headless tells, worker consistency, geo coherence.',
    flags: [
      { name: 'online', type: 'boolean', help: 'also open the public detector pages and save a screenshot of each to the output dir' },
      { name: 'headless', type: 'boolean', help: 'test a headless launch instead of the default headed one' },
      { name: 'headed', type: 'boolean', help: 'test the headed profile (the default for selftest; needs a display)' },
      { name: 'isolated', type: 'boolean', help: 'test an isolated (in-memory) profile' },
      { name: 'proxy', type: 'string', help: 'proxy url to test with' },
      { name: 'proxy-bypass', type: 'string', help: 'comma-separated hosts that bypass the proxy' },
      { name: 'geoip', type: 'boolean', help: 'geoip lookup (see open)' },
      { name: 'locale', type: 'string', help: 'browser locale to test with' },
      { name: 'timezone', type: 'string', help: 'iana timezone to test with' },
      { name: 'browser', type: 'string', help: 'chromium channel to test: chrome, msedge or chromium' },
    ],
  },
];

// `headed`/`headful` come from the upstream open flag surface (and are read by the launch
// profile), not from clientFlags; list them so they are stripped before the daemon and
// accepted on any command (e.g. selftest --headed).
export const clientOnlyFlagNames: string[] = [...new Set([...clientFlags.map(flag => flag.name), 'headed', 'headful'])];

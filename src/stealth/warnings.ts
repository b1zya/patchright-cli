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

// Every way the CLI can be made more detectable has a warning here. They are printed
// whenever the user (or the agent driving the CLI) opts into one; two of them cannot be
// silenced because they change the whole session's posture.

import type { Severity, Warning } from '../output';

export type LeakKey =
  | 'bundled-chromium'
  | 'proxy-without-geoip'
  | 'geoip-failed'
  | 'headless'
  | 'headless-user-agent'
  | 'headless-user-agent-unknown'
  | 'custom-executable'
  | 'device-emulation'
  | 'user-agent'
  | 'manual-geo'
  | 'timezone-emulation'
  | 'locale-emulation'
  | 'viewport-emulation'
  | 'route-cache'
  | 'route-shadows-init'
  | 'init-script-route'
  | 'main-world-eval'
  | 'console-unavailable'
  | 'highlight-dom'
  | 'recorder-injection'
  | 'tracing'
  | 'cdp-attach'
  | 'channel-changed'
  | 'humanize-limits'
  | 'extra-arg'
  | 'no-focus-emulation'
  | 'run-code-emulation';

type CatalogEntry = { severity: Severity, message: string, unsilenceable?: boolean };

export const catalog: Record<LeakKey, CatalogEntry> = {
  'bundled-chromium': {
    severity: 'HIGH',
    unsilenceable: true,
    message: 'Using the bundled Chromium: it exposes "Chromium"/"Chrome for Testing" brands and lacks H.264/Widevine. Install Google Chrome (or Microsoft Edge) for a real-browser fingerprint.',
  },
  'proxy-without-geoip': {
    severity: 'HIGH',
    unsilenceable: true,
    message: 'A proxy is set but geoip is off: the browser timezone, language and geolocation will not match the exit IP. Remove --no-geoip or pass --timezone/--locale that match the proxy.',
  },
  'geoip-failed': {
    severity: 'HIGH',
    message: 'Could not resolve the proxy exit IP location; timezone and language are left as the host defaults and may not match the IP.',
  },
  'headless': {
    severity: 'MEDIUM',
    message: 'Headless is more detectable (font metrics, software WebGL, a fixed viewport) and you are behind a proxy, so this looks anti-detection-sensitive. For a protected or anti-bot site, run --headed on a display (xvfb-run -a on a headless Linux host). Headless is fine for ordinary research, scraping and inspection.',
  },
  'headless-user-agent': {
    severity: 'INFO',
    message: 'The user agent is the headed name of this build, not HeadlessChrome; --no-headless-user-agent keeps the raw one.',
  },
  'headless-user-agent-unknown': {
    severity: 'MEDIUM',
    message: 'Browser version unknown, so the user agent still says HeadlessChrome, which every detector flags; run --headed or set browser.contextOptions.userAgent.',
  },
  'custom-executable': {
    severity: 'LOW',
    message: 'Launching the executable from browser.launchOptions.executablePath instead of an installed channel: the tool cannot vouch for that build\'s brand or flags, and reads its version from the file for the headless user agent.',
  },
  'device-emulation': {
    severity: 'HIGH',
    message: 'Device emulation fabricates the user agent, client hints, touch and screen metrics on a desktop Chrome; the contradictions are detectable.',
  },
  'user-agent': {
    severity: 'HIGH',
    message: 'A custom user agent makes Chrome report client-hint brands and platform derived from the string, which will not match the real binary.',
  },
  'manual-geo': {
    severity: 'MEDIUM',
    message: 'Manual timezone/locale/geolocation override the values derived from the proxy exit IP; a mismatch with the IP is a strong signal.',
  },
  'timezone-emulation': {
    severity: 'MEDIUM',
    message: 'The timezone is applied through CDP emulation (Windows has no per-process TZ); out-of-process workers may disagree with the main thread.',
  },
  'locale-emulation': {
    severity: 'LOW',
    message: 'The locale is applied through CDP emulation (macOS ignores --lang); navigator.languages may end up with a single entry.',
  },
  'viewport-emulation': {
    severity: 'MEDIUM',
    message: 'A fixed viewport is emulated with Emulation.setDeviceMetricsOverride; the viewport no longer matches the window.',
  },
  'route-cache': {
    severity: 'LOW',
    message: 'While routes are installed the browser cache is disabled; repeat visits refetch everything.',
  },
  'route-shadows-init': {
    severity: 'MEDIUM',
    message: 'Document requests matching this route skip init-script injection.',
  },
  'init-script-route': {
    severity: 'MEDIUM',
    message: 'Init scripts, exposed functions and clock.install make patchright rewrite every HTML document through a catch-all route for the rest of the session (timing-attack surface).',
  },
  'main-world-eval': {
    severity: 'LOW',
    message: 'Running in the page main world: side effects and stack frames are observable by page scripts and the page CSP applies.',
  },
  'console-unavailable': {
    severity: 'INFO',
    message: 'Page console output is not captured by design: patchright never sends Runtime.enable, which console.* and uncaught-exception capture need; browser-level log entries (failed requests, CSP) are still listed. Use eval --main-world or run-code to read application state.',
  },
  'highlight-dom': {
    severity: 'MEDIUM',
    message: 'This injects overlay DOM into the page, visible to MutationObserver-based scripts.',
  },
  'recorder-injection': {
    severity: 'HIGH',
    message: 'The recorder installs a `__pw_recorder` binding on the page main world and an overlay element on every page until `recording-stop`; a script that enumerates window properties sees it. Record on your own pages, not on a protected one.',
  },
  'tracing': {
    severity: 'LOW',
    message: 'Tracing snapshots the DOM from the utility world on every action; heavy and observable through timing.',
  },
  'cdp-attach': {
    severity: 'LOW',
    message: 'Attached to an external browser: its launch flags are not controlled by patchright-cli. Make sure it was not started with --enable-automation or --headless.',
  },
  'channel-changed': {
    severity: 'LOW',
    message: 'This profile was created with a different browser channel; the same cookies now present a different browser brand.',
  },
  'humanize-limits': {
    severity: 'INFO',
    message: 'Humanized input is a client-side Bézier path over CDP input events; it is not OS-level input and does not defeat event-provenance checks.',
  },
  'extra-arg': {
    severity: 'LOW',
    message: 'Unvetted Chromium switch passed through.',
  },
  'no-focus-emulation': {
    severity: 'LOW',
    message: 'Focus emulation is off: inputs reach an unfocused document while the window is in the background.',
  },
  'run-code-emulation': {
    severity: 'MEDIUM',
    message: 'This code uses emulation APIs (viewport, user agent, CDP Emulation.*) that patchright does not hide.',
  },
};

// A catalog entry surfaced as a note: informational, printed as "Note", never a leak.
export function note(key: LeakKey, detail?: string): Warning {
  const entry = catalog[key];
  return { key, severity: entry.severity, message: detail ? `${entry.message} (${detail})` : entry.message, kind: 'notice' };
}

export function leak(key: LeakKey, detail?: string): Warning {
  const entry = catalog[key];
  return {
    key,
    severity: entry.severity,
    message: detail ? `${entry.message} (${detail})` : entry.message,
    kind: 'leak',
    unsilenceable: entry.unsilenceable,
  };
}

export function notice(key: string, message: string): Warning {
  return { key, severity: 'INFO', message, kind: 'notice' };
}

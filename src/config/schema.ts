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

import type { BrowserContextOptions, LaunchOptions } from 'patchright-core';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

// The `browser` block patchright-core's daemon accepts through --config.
export type DaemonBrowserConfig = {
  browserName?: BrowserName;
  isolated?: boolean;
  userDataDir?: string;
  launchOptions?: LaunchOptions;
  contextOptions?: BrowserContextOptions;
  cdpEndpoint?: string;
  cdpHeaders?: Record<string, string>;
  cdpTimeout?: number;
  initScript?: string[];
  initPage?: string[];
  remoteEndpoint?: string;
};

// What we hand to the daemon as its config file. Keys we do not model pass through verbatim
// (network, timeouts, snapshot, console, saveVideo, secrets, testIdAttribute, ...).
export type DaemonConfig = {
  browser?: DaemonBrowserConfig;
  network?: { allowedOrigins?: string[], blockedOrigins?: string[] };
  timeouts?: { action?: number, navigation?: number, expect?: number, settle?: number };
  outputDir?: string;
  [key: string]: unknown;
};

// Our own settings; resolved by the stealth layer into daemon config, flags and env.
export type StealthConfig = {
  browser?: 'chrome' | 'msedge' | 'chromium';
  headless?: boolean;
  // Headless sessions present the headed user agent of the same build (default true).
  headlessUserAgent?: boolean;
  isolated?: boolean;
  humanize?: boolean;
  proxy?: string;
  geoip?: boolean;
  locale?: string;
  timezone?: string;
};

export type UserConfigLayer = DaemonConfig & {
  stealth?: StealthConfig;
  // Close the browser after this long without a command ("30m", "2h", 0 = never); the
  // default is 30m inside an agent harness and never elsewhere. See src/lifetime.ts.
  idleTimeout?: string | number;
};

// A config file: defaults for every session plus optional per-session overrides.
export type UserConfig = UserConfigLayer & {
  sessions?: Record<string, UserConfigLayer>;
};

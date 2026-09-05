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

// Which Chromium to launch. patchright's own recommended configuration is a real Google
// Chrome; Edge is the next best consumer build; the bundled Chromium is a last resort
// that advertises itself as a testing build.

import fs from 'fs';
import path from 'path';

import { coreBundle } from '../core';

export type Channel = 'chrome' | 'msedge' | 'chromium';

export type ChannelChoice = {
  channel: string;
  executablePath?: string;
  requested?: string;
  fallback: boolean;
};

// Returns the executable path of an installed channel, or undefined.
export type ExecutableFinder = (name: string) => string | undefined;

export const preferredChannels: Channel[] = ['chrome', 'msedge', 'chromium'];
export const unsupportedBrowsers = ['firefox', 'webkit'];

// The registry's executablePath() is where a browser *would* be: for the bundled Chromium it is
// the download location of the revision this patchright-core wants, present or not (a machine
// may hold another Playwright's revision next to it). Only an existing file counts, so the
// channel choice, `doctor` and `env` agree with the daemon, which refuses to launch a missing one.
export function existingExecutable(executablePath: string | undefined, exists: (file: string) => boolean = fs.existsSync): string | undefined {
  return executablePath && exists(executablePath) ? executablePath : undefined;
}

export function coreExecutableFinder(): ExecutableFinder {
  const registry = coreBundle().registry.registry;
  return (name: string) => {
    try {
      const executable = registry.findExecutable(name);
      return existingExecutable(executable?.executablePath('javascript') ?? undefined);
    } catch {
      return undefined;
    }
  };
}

// The version of a browser the registry downloads itself (the bundled Chromium, from
// browsers.json); channels installed by the OS carry none here.
export type BundledVersionFinder = (name: string) => string | undefined;

export function coreBundledVersionFinder(): BundledVersionFinder {
  const registry = coreBundle().registry.registry;
  return (name: string) => {
    try {
      return registry.findExecutable(name)?.browserVersion ?? undefined;
    } catch {
      return undefined;
    }
  };
}

// The registry version of whatever browser lives at a path, for a configured executablePath
// that points into a registry download (the bundled Chromium under another name or root).
export function coreVersionForExecutable(executablePath: string): string | undefined {
  try {
    const wanted = path.resolve(executablePath).toLowerCase();
    for (const executable of coreBundle().registry.registry.executables()) {
      const candidate = executable.executablePath('javascript');
      if (executable.browserVersion && candidate && path.resolve(candidate).toLowerCase() === wanted)
        return executable.browserVersion;
    }
  } catch {
  }
  return undefined;
}

// A browser at a path of the user's choosing (`browser.launchOptions.executablePath` in the
// config): a portable Chrome, an install outside the standard directories, another Chromium
// build. It replaces the channel search entirely, so it works on a machine with no channel at
// all; the daemon launches that file as it is.
export const customChannel = 'custom';

export function resolveChannel(requested: string | undefined, find: ExecutableFinder, executablePath?: string, exists: (file: string) => boolean = fs.existsSync): ChannelChoice {
  if (executablePath) {
    if (requested)
      throw new Error(`--browser=${requested} conflicts with browser.launchOptions.executablePath in the config (${executablePath}); use one or the other.`);
    if (!exists(executablePath))
      throw new Error(`browser.launchOptions.executablePath points at '${executablePath}', which does not exist.`);
    return { channel: customChannel, executablePath, fallback: false };
  }
  if (requested) {
    if (unsupportedBrowsers.includes(requested))
      throw new Error(`--browser=${requested} is not supported: patchright patches Chromium-based browsers only. Use chrome, msedge or chromium.`);
    const executablePath = find(requested);
    if (!executablePath)
      throw new Error(`Browser channel '${requested}' is not installed. Install it or run \`patchright-cli install-browser ${requested}\`.`);
    return { channel: requested, executablePath, requested, fallback: requested === 'chromium' };
  }
  for (const channel of preferredChannels) {
    const executablePath = find(channel);
    if (executablePath)
      return { channel, executablePath, fallback: channel === 'chromium' };
  }
  throw new Error('No Chromium-based browser found. Install Google Chrome or Microsoft Edge, or run `patchright-cli install-browser chromium` (detectable fallback).');
}

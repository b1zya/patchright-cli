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

// Headless Chrome announces itself: navigator.userAgent and the User-Agent header, in every
// frame and worker, say `HeadlessChrome/<version>` where the same build, headed, says
// `Chrome/<version>`. Everything else the browser reports about itself is identical in both
// modes: client-hint brands, fullVersionList, uaFullVersion, platform, architecture, bitness
// (measured on Chrome 152, Windows; see tests/stealth). Every public detector flags the
// marker, so a headless session presents the headed user agent of the very same binary: the
// major version is read from the installed executable and the rest is Chrome's frozen,
// reduced user agent (https://www.chromium.org/updates/ua-reduction/). Nothing is invented.
//
// Why a context userAgent (Emulation.setUserAgentOverride) rather than Chrome's --user-agent
// switch: with the switch Chrome blanks the high-entropy client hints (fullVersionList,
// uaFullVersion, platformVersion, architecture, bitness), which no real browser does. The
// CDP override, which Playwright applies to pages and workers alike with metadata derived
// from the string, keeps brands and full versions real. Its residue is platformVersion,
// which Playwright parses from the string ("10.0" on Windows instead of the build-derived
// value, "10_15_7" on macOS); no known vendor scores it, and it is documented as a residual.

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export type VersionIo = {
  readdir: (dir: string) => string[];
  readFile: (file: string) => string;
  exec: (file: string, args: string[], env?: Record<string, string>) => string;
};

export const defaultVersionIo: VersionIo = {
  readdir: dir => fs.readdirSync(dir),
  readFile: file => fs.readFileSync(file, 'utf8'),
  exec: (file, args, env) => {
    const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000, env: env ? { ...process.env, ...env } : process.env });
    return `${result.stdout ?? ''}${result.stderr ?? ''}`;
  },
};

const fourPartVersion = /(\d+)\.\d+\.\d+\.\d+/;

// The major of a "152.0.7977.82"-style version string (the core registry's browserVersion).
export function majorOf(version: string | undefined): string | undefined {
  return version?.match(/^(\d+)\.\d+/)?.[1];
}

// The major version of a browser found on disk, read without launching a window. The bundled
// Chromium normally never gets here: the core registry knows its version (browsers.ts).
//   win32  - Chrome, Edge and portable Chrome keep the build in a `<version>\` directory next to
//            the executable; one such directory answers it for free. A staged update adds a
//            second one that the browser is not serving yet, and a raw Chromium build has none:
//            both are settled by the executable's own version resource, read through PowerShell;
//   darwin - Contents/Info.plist (CFBundleShortVersionString; plutil for a binary plist);
//   linux  - `<executable> --version` prints "Google Chrome 152.0.7977.82" (Edge, Chromium alike).
// The build `chrome.exe` itself reports: the executable carries the version resource of the
// build it loads, and an update only rewrites it once the browser restarts into that build.
// The path travels in an environment variable: a quoted path loses its backslashes on the way
// through the command line.
function readWindowsProductVersion(executablePath: string, io: VersionIo): string | undefined {
  const output = io.exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:PATCHRIGHT_CLI_EXE).VersionInfo.ProductVersion'], { PATCHRIGHT_CLI_EXE: executablePath });
  return output.match(fourPartVersion)?.[1];
}

export function detectBrowserMajor(executablePath: string, platform: NodeJS.Platform, io: VersionIo = defaultVersionIo): string | undefined {
  const p = platform === 'win32' ? path.win32 : path.posix;
  try {
    if (platform === 'win32') {
      const versions = io.readdir(p.dirname(executablePath))
          .map(name => name.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/))
          .filter((m): m is RegExpMatchArray => !!m)
          .map(m => m.slice(1, 5).map(Number))
          .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
      // One directory is the installed build. Several means an update is staged next to the
      // running one: Chrome keeps the old directory until it restarts into the new build, so
      // the newest directory is a version the browser may not be serving yet, and claiming it
      // in the user agent contradicts the client hints. Ask the launcher which build it loads.
      if (versions.length === 1)
        return String(versions[0][0]);
      const active = readWindowsProductVersion(executablePath, io);
      if (active)
        return active;
      if (versions.length)
        return String(versions[versions.length - 1][0]);
      return undefined;
    }
    if (platform === 'darwin') {
      // <App>.app/Contents/MacOS/<executable> -> <App>.app/Contents/Info.plist
      const plist = p.join(p.dirname(p.dirname(executablePath)), 'Info.plist');
      let text = io.readFile(plist);
      if (!text.includes('<plist'))
        text = io.exec('plutil', ['-convert', 'xml1', '-o', '-', plist]);
      const match = text.match(/<key>(?:CFBundleShortVersionString|KSVersion)<\/key>\s*<string>(\d+)\.\d+\.\d+\.\d+<\/string>/);
      return match?.[1];
    }
    return io.exec(executablePath, ['--version']).match(fourPartVersion)?.[1];
  } catch {
    return undefined;
  }
}

// Chrome's reduced user agent: a frozen platform token per OS, the major version, zeros.
export const reducedPlatformTokens: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'Windows NT 10.0; Win64; x64',
  darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  linux: 'X11; Linux x86_64',
};

export function reducedUserAgent(platform: NodeJS.Platform, channel: string, major: string): string | undefined {
  const token = reducedPlatformTokens[platform];
  if (!token || !/^\d+$/.test(major))
    return undefined;
  const base = `Mozilla/5.0 (${token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
  return channel.startsWith('msedge') ? `${base} Edg/${major}.0.0.0` : base;
}

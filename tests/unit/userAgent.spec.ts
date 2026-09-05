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

import { test, expect } from 'patchright/test';

import { detectBrowserMajor, majorOf, reducedUserAgent } from '../../src/stealth/userAgent';

import type { VersionIo } from '../../src/stealth/userAgent';

const calls: string[] = [];
function io(overrides: Partial<VersionIo> = {}): VersionIo {
  calls.length = 0;
  return {
    readdir: () => { throw new Error('no readdir'); },
    readFile: () => { throw new Error('no readFile'); },
    exec: (file, args) => { calls.push(`${file} ${args.join(' ')}`); return ''; },
    ...overrides,
  };
}

test('reduced user agent: frozen platform token, major version, zeros; Edge adds its suffix', () => {
  expect(reducedUserAgent('win32', 'chrome', '152')).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
  expect(reducedUserAgent('darwin', 'chrome', '152')).toBe('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
  expect(reducedUserAgent('linux', 'chromium', '152')).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36');
  expect(reducedUserAgent('win32', 'msedge', '152')).toMatch(/Chrome\/152\.0\.0\.0 Safari\/537\.36 Edg\/152\.0\.0\.0$/);
  expect(reducedUserAgent('win32', 'msedge-beta', '153')).toContain('Edg/153.0.0.0');
  expect(reducedUserAgent('freebsd', 'chrome', '152')).toBeUndefined();
  expect(reducedUserAgent('win32', 'chrome', '152.0')).toBeUndefined();
  for (const platform of ['win32', 'darwin', 'linux'] as const)
    expect(reducedUserAgent(platform, 'chrome', '152')).not.toMatch(/Headless/);
});

test('windows: the version directory next to the executable, the newest one, without spawning anything', () => {
  const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  expect(detectBrowserMajor(exe, 'win32', io({ readdir: () => ['151.0.7900.10', '152.0.7977.82', 'chrome.exe', 'SetupMetrics'] }))).toBe('152');
  expect(calls).toEqual([]);
  expect(detectBrowserMajor(exe, 'win32', io({ readdir: () => ['152.0.7977.82', '153.0.8010.5'] }))).toBe('153');
  // A portable Chrome keeps the same layout at any path.
  expect(detectBrowserMajor('E:\\Portable\\GoogleChromePortable\\App\\Chrome-bin\\chrome.exe', 'win32', io({ readdir: () => ['152.0.7977.82', 'chrome.exe'] }))).toBe('152');
});

test('windows: a raw Chromium build has no version directory, so the file version is read through PowerShell with the path in the environment', () => {
  const exe = 'C:\\cache\\chromium-1234\\chrome-win64\\chrome.exe';
  let env: Record<string, string> | undefined;
  const raw = io({ readdir: () => ['chrome.exe', 'chrome.dll'], exec: (file, args, e) => { calls.push(file); env = e; return args.join(' ').includes('$env:PATCHRIGHT_CLI_EXE') ? '151.0.7922.34\r\n' : ''; } });
  expect(detectBrowserMajor(exe, 'win32', raw)).toBe('151');
  expect(calls).toEqual(['powershell']);
  expect(env).toEqual({ PATCHRIGHT_CLI_EXE: exe });
  expect(detectBrowserMajor(exe, 'win32', io({ readdir: () => ['chrome.exe'], exec: () => 'Get-Item : cannot find path' }))).toBeUndefined();
});

test('the registry version string reduces to its major', () => {
  expect(majorOf('151.0.7922.34')).toBe('151');
  expect(majorOf('152.0.7977.82')).toBe('152');
  expect(majorOf(undefined)).toBeUndefined();
  expect(majorOf('latest')).toBeUndefined();
});

test('macos: Info.plist beside Contents/MacOS, converting a binary plist with plutil', () => {
  const exe = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const xml = '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleShortVersionString</key>\n\t<string>152.0.7977.82</string><key>KSVersion</key><string>152.0.7977.82</string></dict></plist>';
  const files: Record<string, string> = { '/Applications/Google Chrome.app/Contents/Info.plist': xml };
  expect(detectBrowserMajor(exe, 'darwin', io({ readFile: file => { if (!(file in files)) throw new Error(file); return files[file]; } }))).toBe('152');
  const binary = io({ readFile: () => 'bplist00\u0000garbage', exec: (file, args) => { calls.push(`${file} ${args[0]}`); return xml; } });
  expect(detectBrowserMajor(exe, 'darwin', binary)).toBe('152');
  expect(calls).toEqual(['plutil -convert']);
  expect(detectBrowserMajor(exe, 'darwin', io())).toBeUndefined();
});

test('linux: `<executable> --version`, whatever the product name', () => {
  for (const line of ['Google Chrome 152.0.7977.82 \n', 'Microsoft Edge 152.0.3000.1', 'Chromium 152.0.7977.0 snap']) {
    expect(detectBrowserMajor('/opt/google/chrome/chrome', 'linux', io({ exec: (file, args) => { calls.push(`${file} ${args.join(' ')}`); return line; } }))).toBe('152');
    expect(calls).toEqual(['/opt/google/chrome/chrome --version']);
  }
  expect(detectBrowserMajor('/opt/google/chrome/chrome', 'linux', io({ exec: () => { throw new Error('ENOENT'); } }))).toBeUndefined();
});

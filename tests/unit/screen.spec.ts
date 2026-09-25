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

import { assumedScreen, detectHostScreen, parseLinuxScreen, parseMacScreen, parseWindowsScreen, screenInfoArg, workAreaWindowArg } from '../../src/stealth/screen';

test('windows: primary monitor and work area in logical pixels, the scale from the system DPI', () => {
  // Measured on Windows 11, 2560x1440 at 100% (no AppliedDPI value), taskbar at the bottom.
  expect(parseWindowsScreen('0 0 2560 1440 0 0 2560 1392 \r\n')).toEqual({ width: 2560, height: 1440, insets: { left: 0, top: 0, right: 0, bottom: 48 }, devicePixelRatio: 1, source: 'host' });
  // 150% scaling: powershell.exe is not DPI-aware, so the sizes are already logical.
  expect(parseWindowsScreen('0 0 1707 960 0 0 1707 928 144')).toEqual({ width: 1707, height: 960, insets: { left: 0, top: 0, right: 0, bottom: 32 }, devicePixelRatio: 1.5, source: 'host' });
  // A taskbar on the left.
  expect(parseWindowsScreen('0 0 1920 1080 62 0 1858 1080')!.insets).toEqual({ left: 62, top: 0, right: 0, bottom: 0 });
  // Errors and nonsense are unreadable, never a screen.
  expect(parseWindowsScreen('Add-Type : cannot load')).toBeUndefined();
  expect(parseWindowsScreen('0 0 0 0 0 0 0 0')).toBeUndefined();
  expect(parseWindowsScreen('0 0 1920 1080 0 0 1920 200')).toBeUndefined();
});

test('macOS: NSScreen frame and visible frame, bottom-left origin, backing scale', () => {
  // 1512x982 points at 2x: a 37 pt menu bar at the top, a 70 pt Dock at the bottom.
  expect(parseMacScreen('1512 982 0 70 1512 875 2')).toEqual({ width: 1512, height: 982, insets: { left: 0, top: 37, right: 0, bottom: 70 }, devicePixelRatio: 2, source: 'host' });
  expect(parseMacScreen('execution error: -2700')).toBeUndefined();
});

test('linux: the primary xrandr output, the work area when a window manager publishes one', () => {
  const desktop = 'Screen 0: minimum 320 x 200, current 4480 x 1440, maximum 16384 x 16384\nDP-1 connected primary 2560x1440+0+0 (normal left inverted right x axis y axis) 597mm x 336mm\nHDMI-1 connected 1920x1080+2560+0 527mm x 296mm\n';
  expect(parseLinuxScreen(desktop, '_NET_WORKAREA(CARDINAL) = 0, 32, 2560, 1408, 0, 32, 2560, 1408')).toEqual({ width: 2560, height: 1440, insets: { left: 0, top: 32, right: 0, bottom: 0 }, devicePixelRatio: 1, source: 'host' });
  // xvfb-run: one virtual output, no window manager, so the whole screen is available.
  const xvfb = 'Screen 0: minimum 1 x 1, current 1280 x 1024, maximum 1280 x 1024\nscreen connected primary 1280x1024+0+0 0mm x 0mm\n';
  expect(parseLinuxScreen(xvfb, '_NET_WORKAREA:  not found.')).toEqual({ width: 1280, height: 1024, insets: { left: 0, top: 0, right: 0, bottom: 0 }, devicePixelRatio: 1, source: 'host' });
  // No primary output named: the screen size xrandr reports.
  expect(parseLinuxScreen('Screen 0: minimum 8 x 8, current 1920 x 1080, maximum 32767 x 32767\n', '')!.width).toBe(1920);
  // xrandr missing (the command prints nothing useful): unreadable.
  expect(parseLinuxScreen('', '')).toBeUndefined();
});

test('each platform is probed with its own hidden command, and a failing probe is unreadable', () => {
  const calls: string[] = [];
  const io = (outputs: Record<string, string>) => ({ exec: (file: string) => { calls.push(file); return outputs[file] ?? ''; } });
  expect(detectHostScreen('win32', io({ powershell: '0 0 2560 1440 0 0 2560 1392' }))!.width).toBe(2560);
  expect(detectHostScreen('darwin', io({ osascript: '1440 900 0 0 1440 875 2' }))!.insets.top).toBe(25);
  expect(detectHostScreen('linux', io({ xrandr: 'x connected primary 1920x1080+0+0', xprop: '' }))!.height).toBe(1080);
  expect(calls).toEqual(['powershell', 'osascript', 'xrandr', 'xprop']);
  expect(detectHostScreen('linux', { exec: () => { throw new Error('spawn xrandr ENOENT'); } })).toBeUndefined();
  expect(detectHostScreen('freebsd', io({}))).toBeUndefined();
});

test('the switches Chrome reads: the screen in physical pixels with the scale named, the window over the work area in CSS pixels', () => {
  const windows = parseWindowsScreen('0 0 2560 1440 0 0 2560 1392')!;
  expect(screenInfoArg(windows)).toBe('--screen-info={0,0 2560x1440 workAreaBottom=48}');
  expect(workAreaWindowArg(windows)).toBe('--window-size=2560,1392');
  // Measured: {0,0 2560x1440 devicePixelRatio=1.5 workAreaBottom=48} gives screen 1707x960,
  // available 1707x928 in the page, so a 150% screen is written back in physical pixels.
  const scaled = parseWindowsScreen('0 0 1707 960 0 0 1707 928 144')!;
  expect(screenInfoArg(scaled)).toBe('--screen-info={0,0 2561x1440 devicePixelRatio=1.5 workAreaBottom=48}');
  expect(workAreaWindowArg(scaled)).toBe('--window-size=1707,928');
  const mac = parseMacScreen('1512 982 0 70 1512 875 2')!;
  expect(screenInfoArg(mac)).toBe('--screen-info={0,0 3024x1964 devicePixelRatio=2 workAreaTop=74 workAreaBottom=140}');
  expect(workAreaWindowArg(mac)).toBe('--window-size=1512,875');
});

test('without a display, a common desktop of the platform', () => {
  expect(screenInfoArg(assumedScreen('win32'))).toBe('--screen-info={0,0 1920x1080 workAreaBottom=48}');
  expect(screenInfoArg(assumedScreen('darwin'))).toBe('--screen-info={0,0 2880x1800 devicePixelRatio=2 workAreaTop=50}');
  expect(screenInfoArg(assumedScreen('linux'))).toBe('--screen-info={0,0 1920x1080 workAreaTop=32}');
  for (const platform of ['win32', 'darwin', 'linux'] as const)
    expect(assumedScreen(platform).source).toBe('assumed');
});

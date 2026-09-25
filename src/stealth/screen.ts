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

// The screen a headless session presents. Headless Chrome has no display of its own and
// reports 800x600 with no taskbar (screen == availScreen) and a window that fits inside it,
// on whatever machine it runs: a fixed value every detector knows. Chrome takes the screen
// from `--screen-info={...}` (sizes and work-area insets in physical pixels, divided by
// devicePixelRatio for the page) and the window from `--window-size=W,H` (CSS pixels).
//
// With a display, the screen is the host's primary monitor, measured without a window:
// the same numbers a headed session of the same profile reports, so nothing is invented and
// a profile does not change screens between headed and headless runs. Without one (a server,
// an SSH or service session) a common desktop geometry of the platform stands in, and the
// launch says so. The window fills the work area, like a maximized one.
//
// Measured on Chrome 153, Windows 11, 2560x1440 at 100%: headless reported 800x600 /
// 800x600 / outer 780x580; with the switches, 2560x1440 / 2560x1392 / outer 2560x1392, the
// values of the headed window. What stays headless: a 16 px window frame and a taller
// toolbar in the outer-inner difference (see references/stealth.md).

import type { VersionIo } from './userAgent';

export type ScreenGeometry = {
  // CSS pixels, the values screen.width/height report.
  width: number;
  height: number;
  // Work-area insets in CSS pixels: the taskbar, the menu bar, the Dock, a panel.
  insets: { left: number, top: number, right: number, bottom: number };
  devicePixelRatio: number;
  source: 'host' | 'assumed';
};

export type ScreenIo = Pick<VersionIo, 'exec'>;

const noInsets = { left: 0, top: 0, right: 0, bottom: 0 };

// A common desktop of each platform, for a session with no display to measure: Windows 11 at
// 100% with its 48 px taskbar, a MacBook Air at its default scaling under the menu bar, a
// GNOME desktop with its top bar.
export function assumedScreen(platform: NodeJS.Platform): ScreenGeometry {
  if (platform === 'darwin')
    return { width: 1440, height: 900, insets: { ...noInsets, top: 25 }, devicePixelRatio: 2, source: 'assumed' };
  if (platform === 'win32')
    return { width: 1920, height: 1080, insets: { ...noInsets, bottom: 48 }, devicePixelRatio: 1, source: 'assumed' };
  return { width: 1920, height: 1080, insets: { ...noInsets, top: 32 }, devicePixelRatio: 1, source: 'assumed' };
}

// Plausible, internally consistent numbers only; anything else is treated as unreadable.
function checked(screen: ScreenGeometry): ScreenGeometry | undefined {
  const { width, height, insets, devicePixelRatio } = screen;
  const values = [width, height, insets.left, insets.top, insets.right, insets.bottom, devicePixelRatio];
  if (values.some(value => !Number.isFinite(value) || value < 0))
    return undefined;
  if (width < 640 || height < 480 || width > 16384 || height > 16384)
    return undefined;
  if (insets.left + insets.right >= width / 2 || insets.top + insets.bottom >= height / 2)
    return undefined;
  if (devicePixelRatio < 0.5 || devicePixelRatio > 5)
    return undefined;
  return screen;
}

// Windows: the primary monitor and its work area from System.Windows.Forms. powershell.exe
// is not DPI-aware, so Windows hands it logical pixels, which are CSS pixels; the scale is the
// system DPI (AppliedDPI, absent at 100%). ~0.3 s, hidden.
export const windowsScreenScript = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$s = [System.Windows.Forms.Screen]::PrimaryScreen; $b = $s.Bounds; $w = $s.WorkingArea',
  `$d = (Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop\\WindowMetrics' -Name AppliedDPI -ErrorAction SilentlyContinue).AppliedDPI`,
  '"$($b.X) $($b.Y) $($b.Width) $($b.Height) $($w.X) $($w.Y) $($w.Width) $($w.Height) $d"',
].join('; ');

export function parseWindowsScreen(output: string): ScreenGeometry | undefined {
  const numbers = output.trim().split(/\s+/).map(Number);
  if (numbers.length < 8 || numbers.slice(0, 8).some(n => !Number.isInteger(n)))
    return undefined;
  const [bx, by, bw, bh, wx, wy, ww, wh, dpi] = numbers;
  return checked({
    width: bw,
    height: bh,
    insets: { left: wx - bx, top: wy - by, right: bx + bw - (wx + ww), bottom: by + bh - (wy + wh) },
    devicePixelRatio: Number.isFinite(dpi) && dpi > 0 ? dpi / 96 : 1,
    source: 'host',
  });
}

// macOS: NSScreen through JavaScript for Automation. It is AppKit inside the osascript
// process, not an Apple Event to another application, so no privacy permission is involved.
// The first screen is the one with the menu bar; Cocoa's origin is bottom-left.
export const macScreenScript = [
  'ObjC.import("AppKit")',
  'const s = $.NSScreen.screens.objectAtIndex(0)',
  'const f = s.frame, v = s.visibleFrame',
  '[f.size.width, f.size.height, v.origin.x, v.origin.y, v.size.width, v.size.height, s.backingScaleFactor].join(" ")',
].join('; ');

export function parseMacScreen(output: string): ScreenGeometry | undefined {
  const numbers = output.trim().split(/\s+/).map(Number);
  if (numbers.length !== 7 || numbers.some(n => !Number.isFinite(n)))
    return undefined;
  const [fw, fh, vx, vy, vw, vh, scale] = numbers;
  return checked({
    width: Math.round(fw),
    height: Math.round(fh),
    insets: { left: Math.round(vx), top: Math.round(fh - (vy + vh)), right: Math.round(fw - (vx + vw)), bottom: Math.round(vy) },
    devicePixelRatio: scale,
    source: 'host',
  });
}

// Linux (X11, including Xvfb and XWayland): the primary output from xrandr, else the screen
// size it reports; the work area from the window manager's _NET_WORKAREA when there is one
// (a bare Xvfb has none, and a real Chrome there reports the whole screen as available).
// The scale is taken as 1: a HiDPI desktop scale (GDK_SCALE, Xft.dpi) is not read.
export function parseXrandr(output: string): { width: number, height: number, x: number, y: number } | undefined {
  const primary = output.match(/ connected primary (\d+)x(\d+)\+(\d+)\+(\d+)/) ?? output.match(/ connected (\d+)x(\d+)\+(\d+)\+(\d+)/);
  if (primary)
    return { width: Number(primary[1]), height: Number(primary[2]), x: Number(primary[3]), y: Number(primary[4]) };
  const current = output.match(/current (\d+) x (\d+)/);
  return current ? { width: Number(current[1]), height: Number(current[2]), x: 0, y: 0 } : undefined;
}

export function parseLinuxScreen(xrandr: string, workArea: string): ScreenGeometry | undefined {
  const output = parseXrandr(xrandr);
  if (!output)
    return undefined;
  let insets = noInsets;
  const area = workArea.match(/=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (area) {
    const [x, y, w, h] = area.slice(1, 5).map(Number);
    insets = {
      left: Math.max(0, x - output.x),
      top: Math.max(0, y - output.y),
      right: Math.max(0, output.x + output.width - (x + w)),
      bottom: Math.max(0, output.y + output.height - (y + h)),
    };
  }
  return checked({ width: output.width, height: output.height, insets, devicePixelRatio: 1, source: 'host' });
}

// The host's primary monitor, or undefined when it cannot be read; the caller only asks when
// there is a display. Every probe is hidden and bounded by the io's timeout.
export function detectHostScreen(platform: NodeJS.Platform, io: ScreenIo): ScreenGeometry | undefined {
  try {
    if (platform === 'win32')
      return parseWindowsScreen(io.exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', windowsScreenScript]));
    if (platform === 'darwin')
      return parseMacScreen(io.exec('osascript', ['-l', 'JavaScript', '-e', macScreenScript]));
    if (platform === 'linux')
      return parseLinuxScreen(io.exec('xrandr', ['--current']), io.exec('xprop', ['-root', '_NET_WORKAREA']));
  } catch {
  }
  return undefined;
}

// Chrome's headless screen switch: physical pixels, the scale named when it is not 1.
export function screenInfoArg(screen: ScreenGeometry): string {
  const scale = screen.devicePixelRatio;
  const physical = (value: number) => Math.round(value * scale);
  const parts = [`0,0 ${physical(screen.width)}x${physical(screen.height)}`];
  if (scale !== 1)
    parts.push(`devicePixelRatio=${scale}`);
  for (const [side, name] of [['left', 'workAreaLeft'], ['top', 'workAreaTop'], ['right', 'workAreaRight'], ['bottom', 'workAreaBottom']] as const) {
    if (screen.insets[side])
      parts.push(`${name}=${physical(screen.insets[side])}`);
  }
  return `--screen-info={${parts.join(' ')}}`;
}

// A window that fills the work area, in CSS pixels.
export function workAreaWindowArg(screen: ScreenGeometry): string {
  const { insets } = screen;
  return `--window-size=${screen.width - insets.left - insets.right},${screen.height - insets.top - insets.bottom}`;
}

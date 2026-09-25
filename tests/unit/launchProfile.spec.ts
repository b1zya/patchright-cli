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

import fs from 'fs';
import path from 'path';
import { test, expect } from 'patchright/test';

import { existingExecutable, resolveChannel } from '../../src/stealth/browsers';
import { acceptLanguages, createLaunchProfileResolver, describeLaunch, resolveBrowserMode, webrtcPolicyArg, writeAcceptLanguagePreference } from '../../src/stealth/launchProfile';
import { readIdentity } from '../../src/stealth/identity';

import type { LaunchDeps } from '../../src/stealth/launchProfile';
import type { LaunchRequest } from '../../src/stealth';
import type { MinimistArgs } from '../../src/args';

const allInstalled = (name: string) => ({ chrome: '/chrome', msedge: '/msedge', chromium: '/chromium' } as Record<string, string>)[name];
const geo = { ip: '1.2.3.4', countryCode: 'DE', timezone: 'Europe/Berlin', latitude: 52.5, longitude: 13.4, lookedUpAt: 'now', source: 'test' };

// The host monitor a headless launch mirrors: 1920x1080 with a 40 px panel at the bottom.
const hostScreen = { width: 1920, height: 1080, insets: { left: 0, top: 0, right: 0, bottom: 40 }, devicePixelRatio: 1, source: 'host' as const };
const hostScreenArgs = ['--screen-info={0,0 1920x1080 workAreaBottom=40}', '--window-size=1920,1040'];

function deps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
  return { find: allInstalled, lookupGeo: async () => geo, platform: 'linux', writeProfileFiles: false, display: () => ({ available: true, humanVisible: true, detail: 'test display' }), browserVersion: () => '152', exists: () => true, hostScreen: () => hostScreen, ...overrides };
}
const noDisplay = { display: () => ({ available: false, humanVisible: false, detail: 'no DISPLAY or WAYLAND_DISPLAY' }) };

function request(args: MinimistArgs, extra: Partial<LaunchRequest> = {}): LaunchRequest {
  return { mode: 'open', sessionName: 'default', cwd: '/cwd', workspaceDir: '/ws', args, userConfig: {}, daemonProfilesDir: '/root/daemon/h', ...extra };
}

const keys = (profile: { warnings: { key: string }[] }) => profile.warnings.map(w => w.key);
// The note a headless launch always carries (the user agent it presents); leaks are the rest.
const headlessNote = { key: 'headless-user-agent', kind: 'notice', severity: 'INFO', message: expect.stringContaining('headed name of this build') };
const chromeUa = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

test('only an existing executable counts: the registry path of a bundled Chromium that was never downloaded is not "installed"', () => {
  const wanted = 'C:\\Users\\me\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
  expect(existingExecutable(wanted, () => false)).toBeUndefined();
  expect(existingExecutable(wanted, file => file === wanted)).toBe(wanted);
  expect(existingExecutable(undefined, () => true)).toBeUndefined();
  // Without a real browser and without the bundle, the choice fails with the install hint
  // instead of handing the daemon a path it will refuse.
  expect(() => resolveChannel(undefined, name => existingExecutable(name === 'chromium' ? wanted : undefined, () => false))).toThrow(/install-browser chromium/);
});

test('a configured executablePath replaces the channel search: works with no channel installed, is launched as it is, and gets its own user agent', async () => {
  const none = () => undefined;
  const portable = '/opt/portable/chrome/chrome';
  // A fresh config per launch, as the CLI loads one per invocation (the resolver fills it in place).
  const userConfig = () => ({ browser: { launchOptions: { executablePath: portable } } });
  // No Chrome, no Edge, no bundle: still launches, without a channel, from that file.
  const profile = await createLaunchProfileResolver(deps({ find: none, browserVersion: (channel, exe) => (channel === 'custom' && exe === portable) ? '150' : undefined }))(request({ _: ['open'] }, { userConfig: userConfig() }));
  expect(profile.daemonConfig.browser!.launchOptions).toEqual({ executablePath: portable, headless: true, args: hostScreenArgs, ignoreDefaultArgs: ['--hide-scrollbars'] });
  expect(profile.daemonConfig.browser!.contextOptions!.userAgent).toContain('Chrome/150.0.0.0');
  expect(keys(profile)).toEqual(['custom-executable', 'headless-user-agent']);
  // An Edge build at a custom path keeps Edge's suffix; an unreadable version is reported, not guessed.
  const edge = await createLaunchProfileResolver(deps({ find: none, platform: 'win32' }))(request({ _: ['open'] }, { userConfig: { browser: { launchOptions: { executablePath: 'D:\\Apps\\Edge\\msedge.exe' } } } }));
  expect(edge.daemonConfig.browser!.contextOptions!.userAgent).toContain('Edg/152.0.0.0');
  const unknown = await createLaunchProfileResolver(deps({ find: none, browserVersion: () => undefined }))(request({ _: ['open'] }, { userConfig: userConfig() }));
  expect(keys(unknown)).toEqual(['custom-executable', 'headless-user-agent-unknown']);
  // The file must exist, and --browser cannot be combined with it.
  await expect(createLaunchProfileResolver(deps({ find: none, exists: () => false }))(request({ _: ['open'] }, { userConfig: userConfig() }))).rejects.toThrow(/does not exist/);
  await expect(createLaunchProfileResolver(deps())(request({ _: ['open'], browser: 'chrome' }, { userConfig: userConfig() }))).rejects.toThrow(/conflicts with browser.launchOptions.executablePath/);
});

test('the launch facts: once on the open line, in full in JSON, the path only for a non-standard browser', async () => {
  const resolve = createLaunchProfileResolver(deps());
  const plain = (await resolve(request({ _: ['open'] }))).launch!;
  expect(plain).toEqual({ channel: 'chrome', executablePath: '/chrome', version: '152', headless: true, profileDir: path.join('/root/daemon/h', 'ud-default-chrome'), userAgent: chromeUa, userAgentSource: 'headless', screen: { width: 1920, height: 1080, devicePixelRatio: 1, source: 'host' } });
  expect(describeLaunch(plain)).toBe('chrome 152, headless, profile ud-default-chrome, user agent Chrome/152 (headed name of this build)');
  // Headed: the browser's own user agent, nothing to add. Isolated: no profile directory.
  expect(describeLaunch((await resolve(request({ _: ['open'], headed: true }))).launch!)).toBe('chrome 152, headed, profile ud-default-chrome');
  expect(describeLaunch((await resolve(request({ _: ['open'], isolated: true }))).launch!)).toBe('chrome 152, headless, isolated profile, user agent Chrome/152 (headed name of this build)');
  // Edge presents its own token; the bundled fallback and a configured executable show their path.
  const edge = await createLaunchProfileResolver(deps({ platform: 'win32', find: n => n === 'msedge' ? 'C:\\edge\\msedge.exe' : undefined }))(request({ _: ['open'] }));
  expect(describeLaunch(edge.launch!)).toBe('msedge 152, headless, profile ud-default-msedge, user agent Edg/152 (headed name of this build)');
  const bundled = await createLaunchProfileResolver(deps({ find: n => n === 'chromium' ? '/cache/chromium-1234/chrome-linux/chrome' : undefined }))(request({ _: ['open'] }));
  expect(describeLaunch(bundled.launch!)).toBe('bundled chromium 152 at /cache/chromium-1234/chrome-linux/chrome, headless, profile ud-default-chromium, user agent Chrome/152 (headed name of this build)');
  const custom = await createLaunchProfileResolver(deps({ find: () => undefined }))(request({ _: ['open'], headed: true }, { userConfig: { browser: { launchOptions: { executablePath: '/opt/portable/chrome/chrome' } } } }));
  expect(describeLaunch(custom.launch!)).toBe('custom executable 152 /opt/portable/chrome/chrome, headed, profile ud-default-custom');
  // A user agent from the config is named as such, never echoed.
  const own = await resolve(request({ _: ['open'] }, { userConfig: { browser: { contextOptions: { userAgent: 'Custom/1.0' } } } }));
  expect(describeLaunch(own.launch!)).toBe('chrome 152, headless, profile ud-default-chrome, user agent from config');
  // Attach has no launch of its own.
  expect((await resolve(request({ _: ['attach'], cdp: 'http://localhost:9222' }, { mode: 'attach' }))).launch).toBeUndefined();
});

test('channel preference: chrome, then msedge, then bundled chromium with a warning', () => {
  expect(resolveChannel(undefined, allInstalled).channel).toBe('chrome');
  expect(resolveChannel(undefined, n => n === 'msedge' ? '/msedge' : undefined)).toEqual({ channel: 'msedge', executablePath: '/msedge', fallback: false });
  expect(resolveChannel(undefined, n => n === 'chromium' ? '/c' : undefined).fallback).toBe(true);
  expect(resolveChannel('chromium', allInstalled).fallback).toBe(true);
  expect(() => resolveChannel('firefox', allInstalled)).toThrow(/not supported/);
  expect(() => resolveChannel('msedge', () => undefined)).toThrow(/not installed/);
  expect(() => resolveChannel(undefined, () => undefined)).toThrow(/No Chromium-based browser/);
});

test('default open is headless, persistent, real Chrome, real OS preferences (least intrusive, works displayless)', async () => {
  const profile = await createLaunchProfileResolver(deps())(request({ _: ['open'] }));
  expect(profile.daemonFlags).toEqual({ persistent: true });
  expect(profile.env).toBeUndefined();
  expect(profile.warnings).toEqual([headlessNote]);
  expect(profile.daemonConfig.browser!.contextOptions!.userAgent).toBe(chromeUa);
  const browser = profile.daemonConfig.browser!;
  expect(browser.browserName).toBe('chromium');
  expect(browser.isolated).toBe(false);
  // Headless by default, so no visible window and no --start-maximized; the screen is the host
  // monitor's with a window over its work area, and Chrome keeps its scrollbars.
  expect(browser.launchOptions).toEqual({ channel: 'chrome', headless: true, args: hostScreenArgs, ignoreDefaultArgs: ['--hide-scrollbars'] });
  expect(browser.contextOptions).toEqual({ viewport: null, colorScheme: 'no-override', reducedMotion: 'no-override', forcedColors: 'no-override', contrast: 'no-override', userAgent: chromeUa });
  expect(profile.daemonConfig.outputDir).toBe(path.join('/ws', '.patchright-cli'));
});

test('--headed on a display gives a visible, maximized window without warnings and without the bad-flags infobar', async () => {
  for (const args of [{ _: ['open'], headed: true }, { _: ['open'], headful: true }]) {
    const profile = await createLaunchProfileResolver(deps())(request(args));
    // --test-type= keeps Chrome from showing its "unsupported command-line flag" bar for
    // Patchright's --disable-blink-features=AutomationControlled; headless never gets it.
    expect(profile.daemonConfig.browser!.launchOptions).toEqual({ channel: 'chrome', headless: false, args: ['--start-maximized', '--test-type='] });
    expect(profile.warnings).toEqual([]);
  }
  const own = await createLaunchProfileResolver(deps())(request({ _: ['open'], headed: true, 'extra-arg': '--test-type=webdriver' }));
  expect(own.daemonConfig.browser!.launchOptions!.args).toEqual(['--start-maximized', '--test-type=webdriver']);
});

test('--headed with no display is a clear, platform-specific error, never a silent downgrade', async () => {
  const linux = createLaunchProfileResolver(deps(noDisplay));
  await expect(linux(request({ _: ['open'], headed: true }))).rejects.toThrow(/xvfb-run/);
  const mac = createLaunchProfileResolver(deps({ ...noDisplay, platform: 'darwin' }));
  await expect(mac(request({ _: ['open'], headed: true }))).rejects.toThrow(/Aqua window server/);
  const win = createLaunchProfileResolver(deps({ ...noDisplay, platform: 'win32' }));
  await expect(win(request({ _: ['open'], headed: true }))).rejects.toThrow(/Windows desktop/);
  // config-requested headed is refused the same way, naming the config.
  const fromConfig = createLaunchProfileResolver(deps(noDisplay));
  await expect(fromConfig(request({ _: ['open'] }, { userConfig: { stealth: { headless: false } } }))).rejects.toThrow(/config sets a headed browser/);
});

test('no display: an unspecified open falls back to headless and runs (does not error)', async () => {
  // The host monitor is not even asked for: a common desktop stands in, and the launch says so.
  const profile = await createLaunchProfileResolver(deps({ ...noDisplay, hostScreen: () => { throw new Error('asked without a display'); } }))(request({ _: ['open'] }));
  expect(profile.daemonConfig.browser!.launchOptions!.headless).toBe(true);
  expect(profile.daemonConfig.browser!.launchOptions!.args).toEqual(['--screen-info={0,0 1920x1080 workAreaTop=32}', '--window-size=1920,1048']);
  expect(profile.warnings).toEqual([headlessNote, { key: 'headless-screen', kind: 'notice', severity: 'INFO', message: expect.stringContaining('(1920x1080)') }]);
});

test('headless presents the host screen and keeps its scrollbars; what the user set, device emulation and headed are left alone', async () => {
  const resolve = createLaunchProfileResolver(deps());
  const launch = async (args: Partial<MinimistArgs>, userConfig = {}) => (await resolve(request({ _: ['open'], ...args }, { userConfig }))).daemonConfig.browser!.launchOptions!;
  // Headed has a real screen and real scrollbars: nothing to add.
  expect(await launch({ headed: true })).toEqual({ channel: 'chrome', headless: false, args: ['--start-maximized', '--test-type='] });
  // Device emulation brings a screen of its own.
  expect((await launch({ mobile: true })).args).toEqual([]);
  expect((await launch({ device: 'iPhone 15' })).args).toEqual([]);
  // A screen of the user's own, from --extra-arg or the config, wins; so does a window size in the config.
  expect((await launch({ 'extra-arg': '--screen-info={0,0 1366x768}' })).args).toEqual(['--screen-info={0,0 1366x768}']);
  expect((await launch({}, { browser: { launchOptions: { args: ['--window-size=800,600'] } } })).args).toEqual(['--window-size=800,600', '--screen-info={0,0 1920x1080 workAreaBottom=40}']);
  // The user's own ignored defaults are kept, and ignoring all of them stays that.
  expect((await launch({}, { browser: { launchOptions: { ignoreDefaultArgs: ['--mute-audio'] } } })).ignoreDefaultArgs).toEqual(['--mute-audio', '--hide-scrollbars']);
  expect((await launch({}, { browser: { launchOptions: { ignoreDefaultArgs: true } } })).ignoreDefaultArgs).toBe(true);
  // An unreadable monitor on a machine with a display: the common desktop, and the note.
  const unreadable = await createLaunchProfileResolver(deps({ hostScreen: () => undefined, platform: 'win32' }))(request({ _: ['open'] }));
  expect(unreadable.daemonConfig.browser!.launchOptions!.args).toEqual(['--screen-info={0,0 1920x1080 workAreaBottom=48}', '--window-size=1920,1032']);
  expect(keys(unreadable)).toEqual(['headless-user-agent', 'headless-screen']);
  expect(unreadable.launch!.screen).toEqual({ width: 1920, height: 1080, devicePixelRatio: 1, source: 'assumed' });
});

test('headless presents the headed user agent of the same build; headed, a user user agent, an opt-out or an unknown version do not', async () => {
  const resolve = createLaunchProfileResolver(deps());
  // Headed: Chrome already says Chrome/<v>; nothing to override, nothing to say.
  const headed = await resolve(request({ _: ['open'], headed: true }));
  expect(headed.daemonConfig.browser!.contextOptions!.userAgent).toBeUndefined();
  expect(keys(headed)).toEqual([]);
  // The user's own user agent is kept (and warned about as before), never replaced.
  const own = await resolve(request({ _: ['open'] }, { userConfig: { browser: { contextOptions: { userAgent: 'Custom/1.0' } } } }));
  expect(own.daemonConfig.browser!.contextOptions!.userAgent).toBe('Custom/1.0');
  expect(keys(own)).toEqual(['user-agent']);
  // Opt-out by flag or config keeps the raw HeadlessChrome user agent, silently: it was asked for.
  for (const [args, config] of [[{ _: ['open'], 'headless-user-agent': false }, {}], [{ _: ['open'] }, { stealth: { headlessUserAgent: false } }]] as const) {
    const raw = await resolve(request(args as any, { userConfig: config as any }));
    expect(raw.daemonConfig.browser!.contextOptions!.userAgent).toBeUndefined();
    expect(keys(raw)).toEqual([]);
  }
  // Edge gets its suffix; the platform token follows the host.
  const edge = await createLaunchProfileResolver(deps({ platform: 'win32', find: n => n === 'msedge' ? 'C:\\edge\\msedge.exe' : undefined }))(request({ _: ['open'] }));
  expect(edge.daemonConfig.browser!.contextOptions!.userAgent).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0');
  // No version: the leak stays and is reported as one, with the executable, instead of a guess.
  const unknown = await createLaunchProfileResolver(deps({ browserVersion: () => undefined }))(request({ _: ['open'] }));
  expect(unknown.daemonConfig.browser!.contextOptions!.userAgent).toBeUndefined();
  expect(unknown.warnings).toEqual([expect.objectContaining({ key: 'headless-user-agent-unknown', severity: 'MEDIUM', kind: 'leak', message: expect.stringContaining('/chrome') })]);
});

test('resolveBrowserMode follows the task precedence: flag > config > environment > default', () => {
  const display = (available: boolean) => ({ available, humanVisible: available });
  // 1. explicit flag wins over config and environment.
  expect(resolveBrowserMode({ _: ['open'], headless: true }, { headless: false }, display(true))).toEqual({ headless: true, source: 'flag' });
  expect(resolveBrowserMode({ _: ['open'], headed: true }, { headless: true }, display(false))).toEqual({ headless: false, source: 'flag' });
  expect(resolveBrowserMode({ _: ['open'], headful: true }, {}, display(true))).toEqual({ headless: false, source: 'flag' });
  expect(resolveBrowserMode({ _: ['open'], headless: false }, {}, display(true))).toEqual({ headless: false, source: 'flag' }); // --no-headless
  expect(() => resolveBrowserMode({ _: ['open'], headed: true, headless: true }, {}, display(true))).toThrow(/not both/);
  // 2. config when no flag.
  expect(resolveBrowserMode({ _: ['open'] }, { headless: false }, display(true))).toEqual({ headless: false, source: 'config' });
  expect(resolveBrowserMode({ _: ['open'] }, { headless: true }, display(true))).toEqual({ headless: true, source: 'config' });
  // 3. environment: no display forces headless (even without any flag).
  expect(resolveBrowserMode({ _: ['open'] }, {}, display(false))).toEqual({ headless: true, source: 'no-display' });
  // 4. default is headless even with a display: headed is opt-in, never the stealth default.
  expect(resolveBrowserMode({ _: ['open'] }, {}, display(true))).toEqual({ headless: true, source: 'default' });
});

test('headless warns only in an anti-detection-sensitive context (a proxy)', async () => {
  const withProxy = await createLaunchProfileResolver(deps())(request({ _: ['open'], headless: true, proxy: 'http://u:p@proxy:3128' }));
  expect(keys(withProxy)).toContain('headless');
  // Forced headless because no display, plus a proxy: warn and point at xvfb for --headed.
  const forced = await createLaunchProfileResolver(deps(noDisplay))(request({ _: ['open'], proxy: 'http://u:p@proxy:3128' }));
  expect(forced.warnings.find(w => w.key === 'headless')!.message).toMatch(/xvfb-run/);
});

test('deviations are allowed but warned about', async () => {
  const resolve = createLaunchProfileResolver(deps());
  const headless = await resolve(request({ _: ['open'], headless: true }));
  expect(headless.daemonConfig.browser!.launchOptions!.headless).toBe(true);
  expect(headless.daemonConfig.browser!.launchOptions!.args).toEqual(hostScreenArgs);
  // Ordinary headless is quiet: no leak warning unless the task is anti-detection-sensitive (a
  // proxy); the only line is the note about the user agent it presents.
  expect(keys(headless)).toEqual(['headless-user-agent']);

  const isolated = await resolve(request({ _: ['open'], isolated: true, mobile: true }));
  expect(isolated.daemonConfig.browser!.isolated).toBe(true);
  expect(isolated.daemonFlags).toEqual({ mobile: true });
  expect(keys(isolated)).toEqual(['device-emulation']);

  const chromium = await resolve(request({ _: ['open'], browser: 'chromium', 'window-size': '1200x800', 'extra-arg': '--foo' }));
  expect(keys(chromium)).toEqual(['bundled-chromium', 'headless-user-agent', 'extra-arg']);
  // A window size of the user's own is kept; the screen around it is still the host's.
  expect(chromium.daemonConfig.browser!.launchOptions!.args).toEqual(['--window-size=1200,800', '--screen-info={0,0 1920x1080 workAreaBottom=40}', '--foo']);
  expect(chromium.warnings[0].unsilenceable).toBe(true);

  const ua = await resolve(request({ _: ['open'] }, { userConfig: { browser: { contextOptions: { userAgent: 'X', viewport: { width: 1, height: 1 } } } } }));
  expect(keys(ua)).toEqual(['viewport-emulation', 'user-agent']);
  expect(ua.daemonConfig.browser!.contextOptions!.viewport).toEqual({ width: 1, height: 1 });

  await expect(resolve(request({ _: ['open'], browser: 'firefox' }))).rejects.toThrow(/not supported/);
  await expect(resolve(request({ _: ['attach'], extension: true }))).rejects.toThrow(/extension/);
});

test('proxy: credentials in context options, clean server for launch, webrtc policy, geoip on', async () => {
  const profile = await createLaunchProfileResolver(deps())(request({ _: ['open'], headed: true, proxy: 'http://u:p@proxy:3128', 'proxy-bypass': 'localhost' }));
  const browser = profile.daemonConfig.browser!;
  expect(browser.launchOptions!.proxy).toEqual({ server: 'http://proxy:3128', bypass: 'localhost' });
  expect(browser.contextOptions!.proxy).toEqual({ server: 'http://proxy:3128', username: 'u', password: 'p', bypass: 'localhost' });
  expect(browser.launchOptions!.args).toContain(webrtcPolicyArg);
  // linux: timezone through the environment, locale through --lang, geolocation without a grant.
  expect(profile.env).toEqual({ TZ: 'Europe/Berlin' });
  expect(browser.launchOptions!.args).toContain('--lang=de-DE');
  expect(browser.contextOptions!.geolocation).toEqual({ latitude: 52.5, longitude: 13.4, accuracy: 100 });
  expect(browser.contextOptions!.permissions).toBeUndefined();
  expect(browser.contextOptions!.timezoneId).toBeUndefined();
  expect(browser.contextOptions!.locale).toBeUndefined();
  expect(profile.warnings).toEqual([]);
});

test('proxy without geoip is an unsilenceable warning; failed lookups warn', async () => {
  const noGeo = await createLaunchProfileResolver(deps())(request({ _: ['open'], headed: true, proxy: 'http://proxy:3128', geoip: false }));
  expect(noGeo.warnings).toEqual([expect.objectContaining({ key: 'proxy-without-geoip', unsilenceable: true })]);
  expect(noGeo.env).toBeUndefined();

  const failed = await createLaunchProfileResolver(deps({ lookupGeo: async () => { throw new Error('offline'); } }))(request({ _: ['open'], headed: true, proxy: 'http://proxy:3128' }));
  expect(keys(failed)).toEqual(['geoip-failed']);
  expect(failed.warnings[0].message).toContain('offline');
});

test('windows emulates the timezone, macOS emulates the locale, manual values override geoip', async () => {
  const win = await createLaunchProfileResolver(deps({ platform: 'win32' }))(request({ _: ['open'], headed: true, proxy: 'http://proxy:3128' }));
  expect(win.daemonConfig.browser!.contextOptions!.timezoneId).toBe('Europe/Berlin');
  expect(win.env).toBeUndefined();
  expect(keys(win)).toEqual(['timezone-emulation']);
  expect(win.daemonConfig.browser!.launchOptions!.args).toContain('--lang=de-DE');

  const mac = await createLaunchProfileResolver(deps({ platform: 'darwin' }))(request({ _: ['open'], headed: true, proxy: 'http://proxy:3128' }));
  expect(mac.daemonConfig.browser!.contextOptions!.locale).toBe('de-DE');
  expect(mac.env).toEqual({ TZ: 'Europe/Berlin' });
  expect(keys(mac)).toEqual(['locale-emulation']);

  const manual = await createLaunchProfileResolver(deps())(request({ _: ['open'], headed: true, proxy: 'http://proxy:3128', timezone: 'Asia/Tokyo', locale: 'ja-JP', grant: 'geolocation,notifications' }));
  expect(manual.env).toEqual({ TZ: 'Asia/Tokyo' });
  expect(manual.daemonConfig.browser!.launchOptions!.args).toContain('--lang=ja-JP');
  expect(manual.daemonConfig.browser!.contextOptions!.permissions).toEqual(['geolocation', 'notifications']);
  expect(keys(manual)).toEqual(['manual-geo']);

  // Explicit --geoip without a proxy still resolves the host's own location.
  const hostGeo = await createLaunchProfileResolver(deps())(request({ _: ['open'], geoip: true }));
  expect(hostGeo.env).toEqual({ TZ: 'Europe/Berlin' });
});

test('config stealth block sets defaults that flags override', async () => {
  const resolve = createLaunchProfileResolver(deps());
  const fromConfig = await resolve(request({ _: ['open'] }, { userConfig: { stealth: { browser: 'msedge', headless: true, proxy: 'http://cfg:1', geoip: false } } }));
  expect(fromConfig.daemonConfig.browser!.launchOptions!.channel).toBe('msedge');
  expect(fromConfig.daemonConfig.browser!.launchOptions!.headless).toBe(true);
  expect(fromConfig.daemonConfig.browser!.launchOptions!.proxy).toEqual({ server: 'http://cfg:1' });
  expect(keys(fromConfig)).toEqual(['headless-user-agent', 'headless', 'proxy-without-geoip']);

  const overridden = await resolve(request({ _: ['open'], headed: true, browser: 'chrome' }, { userConfig: { stealth: { browser: 'msedge', headless: true } } }));
  expect(overridden.daemonConfig.browser!.launchOptions!.channel).toBe('chrome');
  expect(overridden.daemonConfig.browser!.launchOptions!.headless).toBe(false);
});

test('attach only adds our config and a warning', async () => {
  const profile = await createLaunchProfileResolver(deps({ find: () => { throw new Error('must not probe'); } }))(request({ _: ['attach'], cdp: 'http://localhost:9222' }, { mode: 'attach' }));
  expect(profile.daemonFlags).toEqual({ cdp: 'http://localhost:9222' });
  expect(keys(profile)).toEqual(['cdp-attach']);
  expect(profile.daemonConfig.browser!.launchOptions).toEqual({});
});

test('persistent profiles get an identity file and an Accept-Language preference', async () => {
  const daemonProfilesDir = test.info().outputPath('daemon');
  const resolve = createLaunchProfileResolver(deps({ writeProfileFiles: true }));
  await resolve(request({ _: ['open'], proxy: 'http://proxy:3128' }, { daemonProfilesDir }));
  const profileDir = path.join(daemonProfilesDir, 'ud-default-chrome');
  const identity = readIdentity(profileDir)!;
  expect(identity).toEqual(expect.objectContaining({ version: 1, channel: 'chrome', locale: 'de-DE', timezone: 'Europe/Berlin', geo: expect.objectContaining({ countryCode: 'DE' }) }));
  const prefs = JSON.parse(fs.readFileSync(path.join(profileDir, 'Default', 'Preferences'), 'utf8'));
  expect(prefs.intl.accept_languages).toBe('de-DE,de,en-US,en');

  // Re-opening with another channel keeps the identity but warns.
  const again = await resolve(request({ _: ['open'], browser: 'msedge' }, { daemonProfilesDir, sessionName: 'default' }));
  expect(keys(again)).toEqual(['headless-user-agent']);
  expect(readIdentity(path.join(daemonProfilesDir, 'ud-default-msedge'))!.channel).toBe('msedge');
  expect(readIdentity(profileDir)!.createdAt).toBe(identity.createdAt);
});

test('accept language list and preference writing preserve existing preferences', () => {
  expect(acceptLanguages('de-DE')).toBe('de-DE,de,en-US,en');
  expect(acceptLanguages('en-US')).toBe('en-US,en');
  const profileDir = test.info().outputPath('profile');
  fs.mkdirSync(path.join(profileDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(profileDir, 'Default', 'Preferences'), JSON.stringify({ intl: { other: 1 }, keep: true }));
  writeAcceptLanguagePreference(profileDir, 'fr-FR');
  expect(JSON.parse(fs.readFileSync(path.join(profileDir, 'Default', 'Preferences'), 'utf8'))).toEqual({ intl: { other: 1, accept_languages: 'fr-FR,fr,en-US,en' }, keep: true });
});

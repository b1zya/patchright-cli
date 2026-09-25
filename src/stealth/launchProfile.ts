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

// What `open` launches unless told otherwise: patchright's own validated configuration (real
// Chrome, persistent context, no viewport override) plus proxy/geo coherence, headless by
// default and a maximized headed window on request, with a warning for every deviation
// that weakens the anti-detection posture in a context where it matters.

import fs from 'fs';
import path from 'path';

import { detectDisplay } from '../commands/env';
import { defaultOutputDir, toDaemonConfig } from '../config/load';
import { writeState } from '../humanize/state';
import { coreBundledVersionFinder, coreExecutableFinder, coreVersionForExecutable, customChannel, resolveChannel } from './browsers';
import { localeForCountry, lookupGeo } from './geo';
import { readIdentity, reconcileIdentity, writeIdentity } from './identity';
import { contextProxy, launchProxy, parseProxy } from './proxy';
import { assumedScreen, detectHostScreen, screenInfoArg, workAreaWindowArg } from './screen';
import { defaultVersionIo, detectBrowserMajor, majorOf, reducedUserAgent } from './userAgent';
import { leak, note } from './warnings';

import type { MinimistArgs } from '../args';
import type { DaemonConfig } from '../config/schema';
import type { Warning } from '../output';
import type { DaemonFlags, LaunchFacts, LaunchProfile, LaunchRequest } from './index';
import type { ExecutableFinder } from './browsers';
import type { ScreenGeometry } from './screen';
import type { GeoInfo, GeoLookup } from './geo';
import type { ParsedProxy } from './proxy';

export type LaunchDeps = {
  find: ExecutableFinder;
  lookupGeo: GeoLookup;
  platform: NodeJS.Platform;
  writeProfileFiles: boolean;
  // Whether a headed browser can draw and be seen; injected so mode selection is testable.
  display: () => { available: boolean, humanVisible: boolean, detail: string };
  // The major version of the browser a channel resolves to, without launching it: the core
  // registry for the bundled Chromium, the executable itself for Chrome and Edge (userAgent.ts).
  browserVersion: (channel: string, executablePath: string) => string | undefined;
  // Whether a file exists; injected so a configured executablePath can be tested without one.
  exists: (file: string) => boolean;
  // The host's primary monitor, measured without a window (screen.ts); asked only when there
  // is a display, undefined when it cannot be read.
  hostScreen: () => ScreenGeometry | undefined;
};

export const webrtcPolicyArg = '--force-webrtc-ip-handling-policy=disable_non_proxied_udp';

export type BrowserMode = { headless: boolean, source: 'flag' | 'config' | 'no-display' | 'default' };

// The headless/headful decision, in the task's precedence order:
//   1. explicit user preference: --headless / --headed (or --headful);
//   2. a hard technical requirement of the task is handled by the caller/guards, not here;
//   3. environment: with no usable display a headed browser cannot draw, so headless;
//   4. task-based default: the least intrusive mode is headless. The agent escalates to
//      --headed from the skill when the task actually needs a visible browser (interactive
//      login, CAPTCHA, anti-bot that fails headless, debugging you must watch).
// A visible browser is never the default merely because it is stealthier: headed is opt-in.
export function resolveBrowserMode(args: MinimistArgs, stealth: { headless?: boolean }, display: { available: boolean }): BrowserMode {
  const askedHeaded = args.headed === true || args.headful === true || args.headless === false; // --no-headless
  if (args.headless === true && askedHeaded)
    throw new Error('Pass either --headless or --headed, not both.');
  if (args.headless === true)
    return { headless: true, source: 'flag' };
  if (askedHeaded)
    return { headless: false, source: 'flag' };
  if (typeof stealth.headless === 'boolean')
    return { headless: stealth.headless, source: 'config' };
  if (!display.available)
    return { headless: true, source: 'no-display' };
  return { headless: true, source: 'default' };
}

// A headed browser was explicitly requested (flag or config) but nothing can draw it.
// We refuse with a concrete, platform-specific reason instead of letting Chrome fail with
// an opaque launch error, and never silently downgrade an explicit request to headless.
function headedWithoutDisplayError(platform: NodeJS.Platform, source: BrowserMode['source'], detail: string): Error {
  const asked = source === 'config' ? 'The config sets a headed browser (stealth.headless: false)' : 'You asked for a headed browser (--headed)';
  const fix = platform === 'linux'
    ? `no display is available (${detail}). Wrap the command in a virtual display, \`xvfb-run -a patchright-cli ...\` (install xvfb), run it on a machine with a screen, or drop --headed to run headless.`
    : platform === 'darwin'
      ? `this is not an interactive macOS GUI session (${detail}). Headed Chrome needs the Aqua window server of a logged-in desktop session (there is no macOS Xvfb equivalent). Run it from the desktop session, or drop --headed to run headless.`
      : `this is not an interactive desktop session (${detail}). Headed Chrome needs a logged-in Windows desktop. Run it in the user's desktop session, or drop --headed to run headless.`;
  return new Error(`${asked} but ${fix}`);
}

function flagString(args: MinimistArgs, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === false || value === true)
    return undefined;
  return Array.isArray(value) ? value[value.length - 1] : String(value);
}

function flagList(args: MinimistArgs, name: string): string[] {
  const value = args[name];
  if (value === undefined || typeof value === 'boolean')
    return [];
  return Array.isArray(value) ? value : [value];
}

export function acceptLanguages(locale: string): string {
  const language = locale.split('-')[0];
  const list = [locale, language, 'en-US', 'en'];
  return list.filter((item, i) => list.indexOf(item) === i).join(',');
}

// Chrome reads intl.accept_languages from the profile at startup; a real user's profile
// carries a multi-entry list, while Emulation.setUserAgentOverride yields a single one.
export function writeAcceptLanguagePreference(profileDir: string, locale: string): void {
  const file = path.join(profileDir, 'Default', 'Preferences');
  let prefs: any = {};
  try {
    prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
  }
  if (!prefs || typeof prefs !== 'object')
    prefs = {};
  prefs.intl = { ...(prefs.intl ?? {}), accept_languages: acceptLanguages(locale) };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prefs));
}

export function profileDirFor(request: LaunchRequest, channel: string, explicit?: string): string {
  return explicit ? path.resolve(request.cwd, explicit) : path.join(request.daemonProfilesDir, `ud-${request.sessionName}-${channel}`);
}

export function createLaunchProfileResolver(deps: LaunchDeps) {
  return async function resolveLaunchProfile(request: LaunchRequest): Promise<LaunchProfile> {
    const warnings: Warning[] = [];
    const args = request.args;
    const stealth = request.userConfig.stealth ?? {};
    const config: DaemonConfig = toDaemonConfig(request.userConfig, { outputDir: defaultOutputDir(request.workspaceDir, request.cwd) });
    const browser = (config.browser ??= {});
    const launchOptions: Record<string, any> = (browser.launchOptions ??= {});
    const contextOptions: Record<string, any> = (browser.contextOptions ??= {});
    const env: Record<string, string> = {};

    if (args.extension)
      throw new Error('Attaching through the browser extension is not supported by patchright-cli.');

    // Attaching to an external browser: nothing to launch, only our config and a warning.
    if (request.mode === 'attach' || args.cdp || args.endpoint) {
      const flags: DaemonFlags = {};
      if (args.cdp)
        flags.cdp = String(args.cdp);
      else if (args.endpoint)
        flags.endpoint = String(args.endpoint);
      warnings.push(leak('cdp-attach'));
      return { daemonConfig: config, daemonFlags: flags, warnings };
    }

    // Browser channel, or the user's own executable (a path outside the standard directories,
    // a portable build): that one replaces the search and is launched as it is.
    const customExecutable = typeof launchOptions.executablePath === 'string' && launchOptions.executablePath ? launchOptions.executablePath : undefined;
    const choice = resolveChannel(flagString(args, 'browser') ?? stealth.browser, deps.find, customExecutable, deps.exists);
    if (choice.fallback)
      warnings.push(leak('bundled-chromium'));
    browser.browserName = 'chromium';
    if (choice.channel === customChannel)
      warnings.push(leak('custom-executable', choice.executablePath));
    else
      launchOptions.channel = choice.channel;
    // What the binary presents itself as, for the reduced user agent: Edge carries a suffix.
    const uaFlavor = choice.channel === customChannel ? (/msedge|edge/i.test(path.basename(choice.executablePath ?? '')) ? 'msedge' : 'chrome') : choice.channel;

    // Headless by default (least intrusive, works on servers and in isolated/displayless
    // environments); headed is opt-in for tasks that need a visible browser. See resolveBrowserMode.
    const display = deps.display();
    const mode = resolveBrowserMode(args, stealth, display);
    if (!mode.headless && !display.available)
      throw headedWithoutDisplayError(deps.platform, mode.source, display.detail);
    const headless = mode.headless;
    launchOptions.headless = headless;

    const explicitProfile = flagString(args, 'profile');
    const isolated = args.isolated === true || (!explicitProfile && (stealth.isolated ?? false));
    browser.isolated = isolated;
    const flags: DaemonFlags = {};
    if (!isolated)
      flags.persistent = true;
    if (explicitProfile)
      flags.profile = explicitProfile;
    if (args.mobile) {
      flags.mobile = true;
      warnings.push(leak('device-emulation', '--mobile'));
    }
    const device = flagString(args, 'device');
    if (device) {
      flags.device = device;
      warnings.push(leak('device-emulation', `--device=${device}`));
    }

    // Real window, real OS preferences.
    if (contextOptions.viewport === undefined)
      contextOptions.viewport = null;
    else if (contextOptions.viewport)
      warnings.push(leak('viewport-emulation', 'contextOptions.viewport'));
    for (const key of ['colorScheme', 'reducedMotion', 'forcedColors', 'contrast'])
      contextOptions[key] ??= 'no-override';
    if (contextOptions.userAgent)
      warnings.push(leak('user-agent'));
    // Headless Chrome says `HeadlessChrome/<v>` where the same build, headed, says `Chrome/<v>`,
    // and nothing else it reports about itself differs. Present the headed user agent of this
    // very binary (userAgent.ts has the measurements and the trade-off). A user-supplied
    // contextOptions.userAgent is left alone (warned about above), and so is device emulation,
    // which brings its own; off with --no-headless-user-agent or stealth.headlessUserAgent: false.
    let userAgentSource: 'headless' | 'config' | undefined = contextOptions.userAgent ? 'config' : undefined;
    const major = choice.executablePath ? deps.browserVersion(choice.channel, choice.executablePath) : undefined;
    if (headless && !contextOptions.userAgent && !flags.mobile && !device && args['headless-user-agent'] !== false && stealth.headlessUserAgent !== false) {
      const userAgent = major ? reducedUserAgent(deps.platform, uaFlavor, major) : undefined;
      if (userAgent) {
        contextOptions.userAgent = userAgent;
        userAgentSource = 'headless';
        warnings.push(note('headless-user-agent'));
      } else {
        warnings.push(leak('headless-user-agent-unknown', choice.executablePath));
      }
    }
    if (args['focus-emulation'] === false) {
      contextOptions.focusControl = true;
      warnings.push(leak('no-focus-emulation'));
    }

    const chromiumArgs: string[] = [...(launchOptions.args ?? [])];
    const extraArgs = flagList(args, 'extra-arg');
    const windowSize = flagString(args, 'window-size');
    const ownWindow = !!windowSize || chromiumArgs.some(arg => arg.startsWith('--window-size') || arg === '--start-maximized');
    if (windowSize) {
      const match = windowSize.match(/^(\d+)[x,](\d+)$/);
      if (!match)
        throw new Error(`--window-size expects WxH, got '${windowSize}'`);
      chromiumArgs.push(`--window-size=${match[1]},${match[2]}`);
    } else if (!headless && !ownWindow) {
      chromiumArgs.push('--start-maximized');
    }
    // Headless has no display and says 800x600, screen == available screen, whatever the machine:
    // present the host's monitor instead (screen.ts), or a common desktop when there is none,
    // with a window over its work area. A screen or window the user set, and device emulation,
    // which brings its own, are left alone.
    let screen: ScreenGeometry | undefined;
    const ownScreen = [...chromiumArgs, ...extraArgs].some(arg => arg.startsWith('--screen-info'));
    if (headless && !flags.mobile && !device && !ownScreen) {
      screen = (display.available ? deps.hostScreen() : undefined) ?? assumedScreen(deps.platform);
      chromiumArgs.push(screenInfoArg(screen));
      if (!ownWindow)
        chromiumArgs.push(workAreaWindowArg(screen));
      if (screen.source === 'assumed')
        warnings.push(note('headless-screen', `${screen.width}x${screen.height}`));
    }
    // Playwright hides the scrollbars of a headless browser: a 0 px scrollbar where Chrome on
    // every desktop draws one (15 px on Windows 11) is a one-line check. Keep Chrome's own.
    if (headless && launchOptions.ignoreDefaultArgs !== true) {
      const ignored: string[] = Array.isArray(launchOptions.ignoreDefaultArgs) ? launchOptions.ignoreDefaultArgs : [];
      if (!ignored.includes('--hide-scrollbars'))
        launchOptions.ignoreDefaultArgs = [...ignored, '--hide-scrollbars'];
    }
    if (extraArgs.length) {
      chromiumArgs.push(...extraArgs);
      warnings.push(leak('extra-arg', extraArgs.join(' ')));
    }
    // Patchright launches Chrome with --disable-blink-features=AutomationControlled, which Chrome
    // lists as a "bad flag" and announces in a headed window with an "unsupported command-line
    // flag ... stability and security will suffer" infobar (--disable-infobars no longer
    // touches it). `--test-type=` suppresses that prompt; it is what Playwright passes to its
    // own persistent-context windows (recorder, dashboard). Headless has no UI: nothing added.
    // Placed after --extra-arg so a user-supplied --test-type value wins.
    if (!headless && !chromiumArgs.some(arg => arg.startsWith('--test-type')))
      chromiumArgs.push('--test-type=');

    // Proxy and geo coherence.
    let proxy: ParsedProxy | undefined;
    const proxyRaw = flagString(args, 'proxy') ?? stealth.proxy;
    if (proxyRaw) {
      proxy = parseProxy(proxyRaw, flagString(args, 'proxy-bypass'));
      launchOptions.proxy = launchProxy(proxy);
      contextOptions.proxy = contextProxy(proxy);
      if (!chromiumArgs.includes(webrtcPolicyArg))
        chromiumArgs.push(webrtcPolicyArg);
    }

    // Headless is more detectable, so warn — but only when the task is clearly
    // anti-detection-sensitive (a proxy is in play). Ordinary headless automation stays
    // quiet, which is the point of the adaptive default. Escalate to --headed on a display.
    if (headless && proxy)
      warnings.push(leak('headless', mode.source === 'no-display' ? `no display here (${display.detail}) — run --headed under xvfb-run -a, or on a machine with a screen` : undefined));
    const geoipEnabled = proxy ? (args.geoip === false ? false : (stealth.geoip ?? true)) : (args.geoip === true || stealth.geoip === true);
    if (proxy && !geoipEnabled)
      warnings.push(leak('proxy-without-geoip'));
    let geo: GeoInfo | undefined;
    if (geoipEnabled) {
      try {
        geo = await deps.lookupGeo(proxy);
      } catch (e: any) {
        warnings.push(leak('geoip-failed', e.message));
      }
    }

    const manualLocale = flagString(args, 'locale') ?? stealth.locale;
    const manualTimezone = flagString(args, 'timezone') ?? stealth.timezone;
    if (geo && (manualLocale || manualTimezone))
      warnings.push(leak('manual-geo'));
    const locale = manualLocale ?? localeForCountry(geo?.countryCode);
    const timezone = manualTimezone ?? geo?.timezone;

    if (timezone) {
      if (deps.platform === 'win32') {
        contextOptions.timezoneId = timezone;
        warnings.push(leak('timezone-emulation'));
      } else {
        env.TZ = timezone;
      }
    }
    const profileDir = isolated ? undefined : profileDirFor(request, choice.channel, explicitProfile);
    if (locale) {
      if (deps.platform === 'darwin' || !profileDir) {
        contextOptions.locale = locale;
        warnings.push(leak('locale-emulation'));
      } else {
        chromiumArgs.push(`--lang=${locale}`);
        if (deps.writeProfileFiles)
          writeAcceptLanguagePreference(profileDir, locale);
      }
    }
    if (geo?.latitude !== undefined && geo.longitude !== undefined && contextOptions.geolocation === undefined)
      contextOptions.geolocation = { latitude: geo.latitude, longitude: geo.longitude, accuracy: 100 };
    const grant = flagString(args, 'grant');
    if (grant)
      contextOptions.permissions = grant.split(',').map(p => p.trim()).filter(Boolean);

    launchOptions.args = chromiumArgs;

    // Identity file on persistent profiles.
    if (profileDir && deps.writeProfileFiles) {
      const { identity, warnings: identityWarnings } = reconcileIdentity(readIdentity(profileDir), { channel: choice.channel, locale, timezone, geo });
      warnings.push(...identityWarnings);
      writeIdentity(profileDir, identity);
    }

    // Per-session client state: humanize, whether the window is visible, a fresh pointer position.
    const humanize = args.humanize === true || (args.humanize !== false && stealth.humanize === true);
    if (deps.writeProfileFiles)
      writeState(request.daemonProfilesDir, request.sessionName, { humanize, headless });

    const launch: LaunchFacts = {
      channel: choice.channel,
      executablePath: choice.executablePath,
      version: major,
      headless,
      profileDir,
      userAgent: typeof contextOptions.userAgent === 'string' ? contextOptions.userAgent : undefined,
      userAgentSource,
    };
    if (screen)
      launch.screen = { width: screen.width, height: screen.height, devicePixelRatio: screen.devicePixelRatio, source: screen.source };
    return { daemonConfig: config, daemonFlags: flags, env: Object.keys(env).length ? env : undefined, warnings, launch };
  };
}

// The one line `open` prints after "opened with pid": browser and build, mode, profile, the
// user agent when it is not the browser's own. The executable path appears only when it is
// not a standard channel (the bundled fallback, a configured executablePath); a standard
// channel's path is one per machine and lives in `doctor`.
export function describeLaunch(facts: LaunchFacts): string {
  const version = facts.version ? ` ${facts.version}` : '';
  const browser = facts.channel === customChannel
    ? `custom executable${version} ${facts.executablePath ?? ''}`.trimEnd()
    : facts.channel === 'chromium'
      ? `bundled chromium${version}${facts.executablePath ? ` at ${facts.executablePath}` : ''}`
      : `${facts.channel}${version}`;
  const profile = facts.profileDir ? `profile ${path.basename(facts.profileDir)}` : 'isolated profile';
  const presented = facts.userAgent?.match(/(Edg|Chrome)\/\d+/g)?.pop();
  const userAgent = facts.userAgentSource === 'headless'
    ? `, user agent ${presented ?? 'overridden'} (headed name of this build)`
    : facts.userAgentSource === 'config' ? ', user agent from config' : '';
  return `${browser}, ${facts.headless ? 'headless' : 'headed'}, ${profile}${userAgent}`;
}

export const resolveLaunchProfile = createLaunchProfileResolver({
  find: name => coreExecutableFinder()(name),
  lookupGeo: proxy => lookupGeo(proxy),
  platform: process.platform,
  writeProfileFiles: true,
  display: () => detectDisplay(process.platform, process.env),
  // Registry first (the bundled Chromium by channel, or a configured path into a registry
  // download), then the file itself.
  browserVersion: (channel, executablePath) => majorOf(channel === customChannel ? coreVersionForExecutable(executablePath) : coreBundledVersionFinder()(channel)) ?? detectBrowserMajor(executablePath, process.platform),
  exists: file => fs.existsSync(file),
  hostScreen: () => detectHostScreen(process.platform, defaultVersionIo),
});

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

// The in-page part of `selftest`. `runChecks` is serialized with toString() and evaluated
// in the page MAIN world (the isolated world cannot see window.chrome or leaked globals),
// so it must be self-contained: no imports, no closures over module scope.
// The corpus follows what anti-bot vendors and public detectors actually probe:
// automation markers, prototype tampering, headless tells, worker consistency and
// cross-signal plausibility.

export type CheckStatus = 'PASS' | 'FAIL' | 'INFO' | 'SKIP';

export type Check = {
  group: string;
  name: string;
  status: CheckStatus;
  detail?: string;
};

export type PageEnvironment = {
  userAgent: string;
  platform: string;
  language: string;
  languages: string[];
  timezone: string;
  hardwareConcurrency: number;
};

export type InPageResult = {
  checks: Check[];
  env: PageEnvironment;
};

export const selftestPage = `<!doctype html>
<html><head><meta charset="utf-8"><title>patchright-cli selftest</title>
<script src="/asset.js"></script></head>
<body><h1>patchright-cli selftest</h1><button id="btn">button</button>
<iframe id="frame" src="/frame" width="200" height="50"></iframe></body></html>`;

export const selftestFrame = `<!doctype html><html><body>frame</body></html>`;

export const selftestAsset = `window.__selftestAsset = true;`;

export async function runChecks(): Promise<InPageResult> {
  const checks: Check[] = [];
  const add = (group: string, name: string, ok: boolean | null, detail?: string) =>
    checks.push({ group, name, status: ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL', detail });
  const w = window as any;
  const nav = navigator as any;

  // --- automation markers ---
  add('automation', 'navigator.webdriver is not true', nav.webdriver !== true, String(nav.webdriver));
  const leakPattern = /^(__pw|__playwright|__puppeteer|cdc_|\$cdc_|__webdriver|_selenium|__selenium|_phantom|callPhantom|domAutomation|__nightmare|__fxdriver)/i;
  const leaked = Object.getOwnPropertyNames(window).filter(key => leakPattern.test(key));
  add('automation', 'no automation globals', leaked.length === 0, leaked.join(', ') || 'none');
  let stackReads = 0;
  const trap = new Error('selftest');
  Object.defineProperty(trap, 'stack', { get() { stackReads++; return 'trap'; } });
  console.log(trap);
  console.error(trap);
  await new Promise(resolve => setTimeout(resolve, 50));
  add('automation', 'console serialization does not read Error.stack', stackReads === 0, `${stackReads} reads`);
  add('automation', 'window.chrome present', typeof w.chrome === 'object' && w.chrome !== null, typeof w.chrome);
  add('automation', 'navigator.plugins populated', nav.plugins && nav.plugins.length > 0, `${nav.plugins ? nav.plugins.length : 0} plugins`);
  const frameWin = (document.getElementById('frame') as HTMLIFrameElement).contentWindow as any;
  add('automation', 'iframe has no automation globals', !!frameWin && Object.getOwnPropertyNames(frameWin).filter(key => leakPattern.test(key)).length === 0 && frameWin.navigator.webdriver !== true);

  // --- tampering: native functions must still be native ---
  const nativeCheck = (label: string, fn: any) => {
    let native = false;
    try {
      native = typeof fn === 'function' && /\[native code\]/.test(Function.prototype.toString.call(fn));
    } catch {
    }
    add('tamper', `${label} is native`, native);
  };
  nativeCheck('Navigator.hardwareConcurrency getter', Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency')?.get);
  nativeCheck('Screen.width getter', Object.getOwnPropertyDescriptor(Screen.prototype, 'width')?.get);
  nativeCheck('CanvasRenderingContext2D.getImageData', CanvasRenderingContext2D.prototype.getImageData);
  nativeCheck('AudioBuffer.getChannelData', (window as any).AudioBuffer?.prototype.getChannelData);
  nativeCheck('Date.getTimezoneOffset', Date.prototype.getTimezoneOffset);
  nativeCheck('Intl.DateTimeFormat.resolvedOptions', Intl.DateTimeFormat.prototype.resolvedOptions);
  nativeCheck('Function.prototype.toString', Function.prototype.toString);
  add('tamper', 'navigator has no own properties', Object.getOwnPropertyNames(navigator).length === 0, Object.getOwnPropertyNames(navigator).join(', ') || 'none');
  const canvasHash = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 50;
    const ctx = canvas.getContext('2d')!;
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(100, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('patchright-cli <canvas> 1.0', 2, 15);
    return canvas.toDataURL();
  };
  add('tamper', 'canvas rendering is stable across passes', canvasHash() === canvasHash());

  // --- headless / emulation tells ---
  add('headless', 'window has outer dimensions', window.outerWidth > 0 && window.outerHeight > 0, `${window.outerWidth}x${window.outerHeight}`);
  add('headless', 'viewport differs from screen', !(window.innerWidth === screen.width && window.innerHeight === screen.height), `viewport ${window.innerWidth}x${window.innerHeight}, screen ${screen.width}x${screen.height}`);
  const probe = document.createElement('div');
  probe.style.color = 'ActiveText';
  document.body.appendChild(probe);
  const activeText = getComputedStyle(probe).color;
  probe.remove();
  add('headless', 'ActiveText is not the headless default', activeText !== 'rgb(255, 0, 0)', activeText);
  let renderer = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl') as any;
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : (gl ? 'no debug info' : 'no webgl');
  } catch {
  }
  add('headless', 'WebGL renderer is hardware', !!renderer && !/swiftshader|llvmpipe|software|mesa offscreen/i.test(renderer), renderer);
  add('headless', 'user agent has no Headless marker', !/HeadlessChrome|Headless/.test(navigator.userAgent), navigator.userAgent);
  try {
    const uad = (navigator as any).userAgentData;
    const hints = uad ? await uad.getHighEntropyValues(['fullVersionList', 'uaFullVersion', 'platformVersion']) : null;
    const uaMajor = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1];
    const full: string = hints?.fullVersionList?.find((b: any) => /Chrome|Chromium/.test(b.brand))?.version ?? '';
    add('headless', 'client hints carry real full versions', !!hints && full.split('.')[0] === uaMajor && !!hints.uaFullVersion && !!hints.platformVersion, hints ? `${full}, platformVersion ${hints.platformVersion}` : 'no userAgentData');
  } catch (e: any) {
    add('headless', 'client hints carry real full versions', null, e.message);
  }
  add('headless', 'fine pointer and hover media queries', matchMedia('(pointer: fine)').matches && matchMedia('(hover: hover)').matches);
  add('headless', 'navigator.languages has several entries', navigator.languages.length >= 2, navigator.languages.join(','));
  const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
  add('headless', 'navigator.language matches Intl locale', navigator.language.split('-')[0] === intlLocale.split('-')[0], `${navigator.language} vs ${intlLocale}`);
  try {
    const state = (await navigator.permissions.query({ name: 'notifications' as PermissionName })).state;
    const consistent = (Notification.permission === 'default' && state === 'prompt') || Notification.permission === state;
    add('headless', 'notification permission is consistent', consistent, `Notification.permission=${Notification.permission}, permissions.query=${state}`);
  } catch (e: any) {
    add('headless', 'notification permission is consistent', null, e.message);
  }
  add('headless', 'document has focus', null, document.hasFocus() ? 'focused' : 'not focused (window in background)');

  // --- workers must agree with the main thread ---
  const workerSource = `postMessage({ userAgent: navigator.userAgent, platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const worker = new Worker(URL.createObjectURL(new Blob([workerSource])));
    const fromWorker: any = await new Promise((resolve, reject) => {
      worker.onmessage = e => resolve(e.data);
      worker.onerror = e => reject(new Error(e.message));
      setTimeout(() => reject(new Error('worker timeout')), 5000);
    });
    worker.terminate();
    add('workers', 'worker user agent matches', fromWorker.userAgent === navigator.userAgent);
    add('workers', 'worker platform matches', fromWorker.platform === navigator.platform);
    add('workers', 'worker hardwareConcurrency matches', fromWorker.hardwareConcurrency === navigator.hardwareConcurrency);
    add('workers', 'worker language matches', fromWorker.language === navigator.language, `${fromWorker.language} vs ${navigator.language}`);
    add('workers', 'worker timezone matches', fromWorker.timezone === timezone, `${fromWorker.timezone} vs ${timezone}`);
  } catch (e: any) {
    add('workers', 'dedicated worker', null, e.message);
  }

  // --- cross-signal plausibility ---
  const ua = navigator.userAgent;
  const platformOk = (/Win/.test(navigator.platform) && /Windows/.test(ua)) || (/Mac/.test(navigator.platform) && /Macintosh/.test(ua)) || (/Linux/.test(navigator.platform) && /Linux|Android|X11/.test(ua));
  add('signals', 'platform matches user agent', platformOk, `${navigator.platform} / ${ua}`);
  add('signals', 'desktop touch points', navigator.maxTouchPoints <= 1 || /Mobile|Android/.test(ua), String(navigator.maxTouchPoints));
  add('signals', 'screen dimensions are integers', Number.isInteger(screen.width) && Number.isInteger(screen.height), `${screen.width}x${screen.height}`);
  add('signals', 'screen fits the viewport', screen.width >= window.innerWidth, `${screen.width} >= ${window.innerWidth}`);
  add('signals', 'hardwareConcurrency is plausible', navigator.hardwareConcurrency >= 1 && navigator.hardwareConcurrency <= 128, String(navigator.hardwareConcurrency));
  add('signals', 'colorDepth is a real value', [24, 30, 32].includes(screen.colorDepth), String(screen.colorDepth));
  add('signals', 'availWidth leaves room for the taskbar or matches a maximized window', null, `${screen.availWidth}x${screen.availHeight} of ${screen.width}x${screen.height}`);

  return {
    checks,
    env: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: [...navigator.languages],
      timezone,
      hardwareConcurrency: navigator.hardwareConcurrency,
    },
  };
}

export const checksSource: string = runChecks.toString();

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

// Resolves the exit IP of the session (through the proxy, when there is one) into the
// timezone, language and coarse location the browser should present. Every commercial
// anti-bot compares these with the IP; a mismatch is a stronger signal than any of the
// emulation calls needed to fix it.

import { contextProxy } from './proxy';

import type { ParsedProxy } from './proxy';

export type GeoInfo = {
  ip: string;
  countryCode: string;
  timezone: string;
  latitude?: number;
  longitude?: number;
  lookedUpAt: string;
  source: string;
};

// Majority language per country, as a BCP-47 tag Chrome accepts in --lang / Accept-Language.
export const countryLocales: Record<string, string> = {
  US: 'en-US', GB: 'en-GB', IE: 'en-IE', CA: 'en-CA', AU: 'en-AU', NZ: 'en-NZ', IN: 'en-IN', SG: 'en-SG', ZA: 'en-ZA', PH: 'en-PH', NG: 'en-NG', KE: 'en-KE',
  DE: 'de-DE', AT: 'de-AT', CH: 'de-CH', LI: 'de-LI',
  FR: 'fr-FR', BE: 'nl-BE', LU: 'fr-LU', MC: 'fr-MC',
  ES: 'es-ES', MX: 'es-MX', AR: 'es-AR', CO: 'es-CO', CL: 'es-CL', PE: 'es-PE', VE: 'es-VE', EC: 'es-EC', UY: 'es-UY', DO: 'es-DO', GT: 'es-GT', CR: 'es-CR', PA: 'es-PA',
  PT: 'pt-PT', BR: 'pt-BR',
  IT: 'it-IT', NL: 'nl-NL', SE: 'sv-SE', NO: 'nb-NO', DK: 'da-DK', FI: 'fi-FI', IS: 'is-IS',
  PL: 'pl-PL', CZ: 'cs-CZ', SK: 'sk-SK', HU: 'hu-HU', RO: 'ro-RO', BG: 'bg-BG', GR: 'el-GR', HR: 'hr-HR', SI: 'sl-SI', RS: 'sr-RS', LT: 'lt-LT', LV: 'lv-LV', EE: 'et-EE',
  UA: 'uk-UA', RU: 'ru-RU', BY: 'ru-BY', KZ: 'ru-KZ', GE: 'ka-GE', AM: 'hy-AM', AZ: 'az-AZ',
  TR: 'tr-TR', IL: 'he-IL', SA: 'ar-SA', AE: 'ar-AE', EG: 'ar-EG', MA: 'ar-MA', IR: 'fa-IR', PK: 'ur-PK', BD: 'bn-BD',
  JP: 'ja-JP', KR: 'ko-KR', CN: 'zh-CN', TW: 'zh-TW', HK: 'zh-HK', TH: 'th-TH', VN: 'vi-VN', ID: 'id-ID', MY: 'ms-MY',
};

export function localeForCountry(countryCode: string | undefined): string | undefined {
  return countryCode ? countryLocales[countryCode.toUpperCase()] : undefined;
}

export const defaultGeoEndpoints = [
  'https://ipinfo.io/json',
  'http://ip-api.com/json/?fields=status,countryCode,lat,lon,timezone,query',
];

// Accepts both ipinfo.io and ip-api.com shapes.
export function parseGeoResponse(json: any, source: string, now = new Date()): GeoInfo {
  if (!json || typeof json !== 'object')
    throw new Error(`${source}: not a JSON object`);
  if (json.status === 'fail')
    throw new Error(`${source}: ${json.message ?? 'lookup failed'}`);
  const ip = json.ip ?? json.query;
  const countryCode = json.country ?? json.countryCode;
  const timezone = json.timezone;
  if (typeof ip !== 'string' || typeof countryCode !== 'string' || typeof timezone !== 'string')
    throw new Error(`${source}: response is missing ip, country or timezone`);
  let latitude: number | undefined;
  let longitude: number | undefined;
  if (typeof json.loc === 'string' && json.loc.includes(',')) {
    const [lat, lon] = json.loc.split(',').map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon))
      [latitude, longitude] = [lat, lon];
  } else if (typeof json.lat === 'number' && typeof json.lon === 'number') {
    [latitude, longitude] = [json.lat, json.lon];
  }
  return { ip, countryCode: countryCode.toUpperCase(), timezone, latitude, longitude, lookedUpAt: now.toISOString(), source };
}

export type GeoLookup = (proxy?: ParsedProxy) => Promise<GeoInfo>;

// Uses patchright-core's request API so the lookup goes through the same proxy (and the
// same proxy credentials) the browser will use, without extra Node proxy plumbing.
export async function lookupGeo(proxy?: ParsedProxy, options: { timeoutMs?: number, endpoints?: string[] } = {}): Promise<GeoInfo> {
  const endpoints = options.endpoints ?? (process.env.PATCHRIGHT_CLI_GEOIP_URL ? [process.env.PATCHRIGHT_CLI_GEOIP_URL] : defaultGeoEndpoints);
  const timeout = options.timeoutMs ?? 5000;
  const { request } = require('patchright-core') as typeof import('patchright-core');
  const context = await request.newContext({
    timeout,
    ...(proxy ? { proxy: contextProxy(proxy) } : {}),
  });
  const errors: string[] = [];
  try {
    for (const url of endpoints) {
      try {
        const response = await context.get(url, { timeout });
        if (!response.ok())
          throw new Error(`HTTP ${response.status()}`);
        return parseGeoResponse(await response.json(), new URL(url).host);
      } catch (e: any) {
        errors.push(`${url}: ${e.message}`);
      }
    }
  } finally {
    await context.dispose().catch(() => {});
  }
  throw new Error(`geoip lookup failed: ${errors.join('; ')}`);
}

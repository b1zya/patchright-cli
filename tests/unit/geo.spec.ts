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

import http from 'http';
import { test, expect } from 'patchright/test';

import { countryLocales, localeForCountry, lookupGeo, parseGeoResponse } from '../../src/stealth/geo';

test('parses ipinfo.io and ip-api.com responses', () => {
  const now = new Date('2026-09-05T00:00:00Z');
  expect(parseGeoResponse({ ip: '1.2.3.4', country: 'de', timezone: 'Europe/Berlin', loc: '52.52,13.405' }, 'ipinfo.io', now)).toEqual({
    ip: '1.2.3.4', countryCode: 'DE', timezone: 'Europe/Berlin', latitude: 52.52, longitude: 13.405, lookedUpAt: now.toISOString(), source: 'ipinfo.io',
  });
  expect(parseGeoResponse({ status: 'success', query: '5.6.7.8', countryCode: 'US', timezone: 'America/New_York', lat: 40.7, lon: -74 }, 'ip-api.com', now)).toEqual(expect.objectContaining({
    ip: '5.6.7.8', countryCode: 'US', timezone: 'America/New_York', latitude: 40.7, longitude: -74,
  }));
  expect(() => parseGeoResponse({ status: 'fail', message: 'private range' }, 'ip-api.com')).toThrow(/private range/);
  expect(() => parseGeoResponse({ ip: '1.1.1.1' }, 'x')).toThrow(/missing/);
});

test('maps countries to a BCP-47 locale', () => {
  expect(localeForCountry('DE')).toBe('de-DE');
  expect(localeForCountry('gb')).toBe('en-GB');
  expect(localeForCountry('ZZ')).toBeUndefined();
  expect(localeForCountry(undefined)).toBeUndefined();
  for (const [country, locale] of Object.entries(countryLocales))
    expect(locale, country).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
});

test('lookupGeo fetches the first endpoint that answers', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/fail') {
      res.writeHead(500);
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ip: '9.9.9.9', country: 'FR', timezone: 'Europe/Paris', loc: '48.85,2.35' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  try {
    const geo = await lookupGeo(undefined, { endpoints: [`http://127.0.0.1:${port}/fail`, `http://127.0.0.1:${port}/json`], timeoutMs: 5000 });
    expect(geo).toEqual(expect.objectContaining({ ip: '9.9.9.9', countryCode: 'FR', timezone: 'Europe/Paris', latitude: 48.85, source: `127.0.0.1:${port}` }));
    await expect(lookupGeo(undefined, { endpoints: [`http://127.0.0.1:${port}/fail`], timeoutMs: 5000 })).rejects.toThrow(/geoip lookup failed.*HTTP 500/);
  } finally {
    server.close();
  }
});

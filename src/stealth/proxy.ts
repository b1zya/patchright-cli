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

// `--proxy=scheme://user:pass@host:port`. Credentials go to the browser context (native
// Fetch.authRequired handling), the credential-free server URL to the launch options.

export type ProxyProtocol = 'http' | 'https' | 'socks5' | 'socks4';

export type ParsedProxy = {
  protocol: ProxyProtocol;
  server: string;
  username?: string;
  password?: string;
  bypass?: string;
};

const protocols: ProxyProtocol[] = ['http', 'https', 'socks5', 'socks4'];

export function parseProxy(raw: string, bypass?: string): ParsedProxy {
  const text = raw.trim();
  if (!text)
    throw new Error('Proxy URL is empty');
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`Invalid proxy URL: ${raw}`);
  }
  const protocol = url.protocol.replace(/:$/, '').toLowerCase() as ProxyProtocol;
  if (!protocols.includes(protocol))
    throw new Error(`Unsupported proxy scheme '${protocol}'; use http, https, socks5 or socks4`);
  if (!url.hostname)
    throw new Error(`Proxy URL has no host: ${raw}`);

  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  if ((username || password) && protocol.startsWith('socks'))
    throw new Error('Chromium does not support SOCKS proxy authentication; use an HTTP proxy or IP allow-listing on the proxy');

  const port = url.port ? `:${url.port}` : '';
  return {
    protocol,
    server: `${protocol}://${url.hostname}${port}`,
    username,
    password,
    bypass: bypass?.trim() || undefined,
  };
}

// For launchOptions.proxy: no credentials on the command line.
export function launchProxy(proxy: ParsedProxy): { server: string, bypass?: string } {
  return { server: proxy.server, ...(proxy.bypass ? { bypass: proxy.bypass } : {}) };
}

// For contextOptions.proxy: credentials answered to Fetch.authRequired.
export function contextProxy(proxy: ParsedProxy): { server: string, username?: string, password?: string, bypass?: string } {
  return {
    server: proxy.server,
    ...(proxy.username !== undefined ? { username: proxy.username } : {}),
    ...(proxy.password !== undefined ? { password: proxy.password } : {}),
    ...(proxy.bypass ? { bypass: proxy.bypass } : {}),
  };
}

export function describeProxy(proxy: ParsedProxy): string {
  return proxy.username ? `${proxy.protocol}://${proxy.username}:***@${proxy.server.replace(/^[a-z0-9]+:\/\//, '')}` : proxy.server;
}

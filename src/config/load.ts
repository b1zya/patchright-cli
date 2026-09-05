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

// User configuration is merged on the client and handed to the daemon as one generated
// file, so the daemon never reads a playwright-cli config that happens to be around.
//
// Layers, lowest to highest: global (~/.patchright-cli/config.json or PATCHRIGHT_CLI_CONFIG),
// project (.playwright/patchright-cli.config.json under the workspace, or --config=<file>),
// then each layer's sessions.<name> block in the same order.

import fs from 'fs';
import os from 'os';
import path from 'path';

import { env, outputDirName, workspaceMarker } from '../paths';

import type { DaemonConfig, UserConfig, UserConfigLayer } from './schema';

export const projectConfigFileName = 'patchright-cli.config.json';

export type ConfigSource = { file: string, kind: 'global' | 'project' | 'explicit' };

export type LoadedConfig = {
  config: UserConfigLayer;
  // Files that were actually read.
  sources: ConfigSource[];
  warnings: string[];
};

export type LoadOptions = {
  cwd: string;
  workspaceDir?: string;
  sessionName: string;
  explicitPath?: string;
};

export function globalConfigFile(): string {
  return process.env[env.config] || path.join(os.homedir(), '.patchright-cli', 'config.json');
}

export function projectConfigFile(root: string): string {
  return path.join(root, workspaceMarker, projectConfigFileName);
}

export function loadUserConfig(options: LoadOptions): LoadedConfig {
  const candidates: ConfigSource[] = [{ file: globalConfigFile(), kind: 'global' }];
  if (options.explicitPath)
    candidates.push({ file: path.resolve(options.cwd, options.explicitPath), kind: 'explicit' });
  else
    candidates.push({ file: projectConfigFile(options.workspaceDir ?? options.cwd), kind: 'project' });

  const warnings: string[] = [];
  const sources: ConfigSource[] = [];
  const layers: UserConfig[] = [];
  for (const source of candidates) {
    const loaded = readConfigFile(source, warnings);
    if (!loaded)
      continue;
    sources.push(source);
    layers.push(resolveConfigPaths(loaded, path.dirname(source.file)));
  }

  let config: UserConfigLayer = {};
  for (const layer of layers) {
    const { sessions: _sessions, ...base } = layer;
    config = mergeConfig(config, base);
  }
  for (const layer of layers) {
    const session = layer.sessions?.[options.sessionName];
    if (session)
      config = mergeConfig(config, session);
  }
  return { config, sources, warnings };
}

function readConfigFile(source: ConfigSource, warnings: string[]): UserConfig | undefined {
  let text: string;
  try {
    text = fs.readFileSync(source.file, 'utf8');
  } catch {
    if (source.kind === 'explicit')
      throw new Error(`Config file not found: ${source.file}`);
    return undefined;
  }
  try {
    const parsed = JSON.parse(text.replace(/^﻿/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('expected a JSON object');
    return parsed as UserConfig;
  } catch (e: any) {
    if (source.kind === 'explicit')
      throw new Error(`Could not parse config file ${source.file}: ${e.message}`);
    warnings.push(`Ignoring malformed config file ${source.file}: ${e.message}`);
    return undefined;
  }
}

// Paths in a config file are relative to that file, like the daemon does with its own.
export function resolveConfigPaths<T extends UserConfig>(config: T, baseDir: string): T {
  const resolve = (p: string) => path.resolve(baseDir, p);
  const result: UserConfig = { ...config };
  if (result.browser) {
    result.browser = { ...result.browser };
    if (result.browser.userDataDir)
      result.browser.userDataDir = resolve(result.browser.userDataDir);
    if (result.browser.initScript)
      result.browser.initScript = result.browser.initScript.map(resolve);
    if (result.browser.initPage)
      result.browser.initPage = result.browser.initPage.map(resolve);
  }
  if (result.outputDir)
    result.outputDir = resolve(result.outputDir);
  if (result.sessions) {
    result.sessions = Object.fromEntries(Object.entries(result.sessions)
        .map(([name, layer]) => [name, resolveConfigPaths(layer, baseDir)]));
  }
  return result as T;
}

// Same semantics as the daemon's own merge: one level deep for the known objects, later
// values win, `undefined` never overwrites, `null` does (viewport: null is meaningful).
export function mergeConfig(base: UserConfigLayer, overrides: UserConfigLayer): UserConfigLayer {
  const result: UserConfigLayer = { ...base, ...pickDefined(overrides) };
  const browser = mergeObjects(base.browser, overrides.browser);
  if (browser) {
    browser.launchOptions = mergeObjects(base.browser?.launchOptions, overrides.browser?.launchOptions);
    browser.contextOptions = mergeObjects(base.browser?.contextOptions, overrides.browser?.contextOptions);
    if (!browser.launchOptions)
      delete browser.launchOptions;
    if (!browser.contextOptions)
      delete browser.contextOptions;
    result.browser = browser;
  }
  for (const key of ['network', 'timeouts', 'stealth'] as const) {
    const merged = mergeObjects(base[key] as object | undefined, overrides[key] as object | undefined);
    if (merged)
      (result as any)[key] = merged;
  }
  return result;
}

function mergeObjects<T extends object>(a: T | undefined, b: T | undefined): T | undefined {
  if (!a && !b)
    return undefined;
  return { ...(a ?? {}), ...pickDefined(b ?? {}) } as T;
}

function pickDefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function defaultOutputDir(workspaceDir: string | undefined, cwd: string): string {
  return path.join(workspaceDir ?? cwd, outputDirName);
}

// Strips our own keys and fills the daemon-side defaults we always control.
export function toDaemonConfig(config: UserConfigLayer, defaults: { outputDir: string }): DaemonConfig {
  const { stealth: _stealth, idleTimeout: _idleTimeout, ...daemon } = config;
  return { ...daemon, outputDir: daemon.outputDir ?? defaults.outputDir };
}

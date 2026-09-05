/**
 * Copyright (c) Microsoft Corporation.
 * Modifications for patchright-cli (https://github.com/b1zya/patchright-cli).
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

// Locates the installed patchright-core package. The daemon, dashboard, help.json and
// the bundled skill all live inside it; only a few subpaths are in its `exports` map,
// so everything else is required through an absolute path.

import path from 'path';

export type BrowserDescriptor = {
  title: string;
  playwrightVersion: string;
  workspaceDir?: string;
  browser: {
    browserName: string;
    userDataDir?: string;
  };
};

export type ServerRegistry = {
  list(): Promise<Map<string, BrowserDescriptor[]>>;
};

export const coreRoot: string = path.dirname(require.resolve('patchright-core/package.json'));
export const corePackageJSON: { name: string, version: string } = require('patchright-core/package.json');
export const coreVersion: string = corePackageJSON.version;

export function corePath(...parts: string[]): string {
  return path.join(coreRoot, ...parts);
}

export const cliDaemonPath = corePath('lib', 'entry', 'cliDaemon.js');
export const dashboardAppPath = corePath('lib', 'entry', 'dashboardApp.js');
export const coreHelpJsonPath = corePath('lib', 'tools', 'cli-client', 'help.json');
export const coreSkillDir = corePath('lib', 'tools', 'skills', 'playwright-cli');

// coreBundle is ~3.5 MB; load it lazily and only for commands that need it.
export function coreBundle(): any {
  return require('patchright-core/lib/coreBundle');
}

export function utilsBundle(): any {
  return require('patchright-core/lib/utilsBundle');
}

export function serverRegistry(): ServerRegistry {
  return require(corePath('lib', 'serverRegistry.js')).serverRegistry;
}

// Our own package.json, resolved dynamically so the bundler does not inline it.
export const packageRoot: string = path.join(__dirname, '..');
export const packageJSON: { name: string, version: string } = require(path.join(packageRoot, 'package.json'));

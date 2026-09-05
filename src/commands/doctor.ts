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

// `doctor`: everything that decides how stealthy a launch will be, in one place.

import fs from 'fs';
import os from 'os';
import path from 'path';

import { corePackageJSON, packageJSON } from '../core';
import { globalConfigFile, projectConfigFile } from '../config/load';
import { daemonRoot, env, profilesDir, serverRegistryDir, socketsDir, stateRoot, workspaceMarker } from '../paths';
import { coreExecutableFinder, preferredChannels } from '../stealth/browsers';

import type { ClientCommand, CommandContext } from '../stealth';

export type DoctorReport = {
  node: string;
  platform: string;
  cli: { name: string, version: string };
  core: { name: string, version: string };
  browsers: { channel: string, executablePath: string | null }[];
  defaultChannel: string | null;
  dirs: { stateRoot: string, daemon: string, profiles: string, servers: string, sockets: string, workspace: string | null };
  config: { global: string, globalExists: boolean, project: string, projectExists: boolean };
  sessions: { name: string, open: boolean }[];
  timezoneStrategy: string;
  issues: string[];
};

export async function collectDoctorReport(ctx: CommandContext, find = coreExecutableFinder()): Promise<DoctorReport> {
  const issues: string[] = [];
  const browsers = preferredChannels.map(channel => ({ channel, executablePath: find(channel) ?? null }));
  const defaultChannel = browsers.find(b => b.executablePath)?.channel ?? null;
  if (!defaultChannel)
    issues.push('No Chromium-based browser found: install Google Chrome or Microsoft Edge.');
  else if (defaultChannel === 'chromium')
    issues.push('Only the bundled Chromium is available; it is detectable. Install Google Chrome or Microsoft Edge.');

  const workspace = ctx.clientInfo.workspaceDir ?? null;
  const globalFile = globalConfigFile();
  const projectFile = projectConfigFile(workspace ?? process.cwd());

  const stray = [
    path.join(workspace ?? process.cwd(), workspaceMarker, 'cli.config.json'),
    path.join(os.homedir(), workspaceMarker, 'cli.config.json'),
  ].filter(file => fs.existsSync(file));
  for (const file of stray)
    issues.push(`playwright-cli config present at ${file}; it is ignored by patchright-cli (use ${projectFile}).`);

  const mcpEnv = Object.keys(process.env).filter(key => key.startsWith('PLAYWRIGHT_MCP_')).sort();
  if (mcpEnv.length)
    issues.push(`Set but ignored (not passed to the daemon, so they cannot bypass the stealth defaults): ${mcpEnv.join(', ')}. Use the config or the open flags instead, and unset them to avoid confusion.`);
  if (process.env[env.quietWarnings])
    issues.push(`${env.quietWarnings} is set: leak warnings are silenced.`);

  const sessions: { name: string, open: boolean }[] = [];
  for (const entry of ctx.registry.entries(ctx.clientInfo)) {
    const { Session } = await import('../session');
    sessions.push({ name: entry.config.name, open: await new Session(entry).canConnect() });
  }

  return {
    node: process.version,
    platform: `${process.platform} ${os.release()} ${os.arch()}`,
    cli: { name: packageJSON.name, version: packageJSON.version },
    core: { name: corePackageJSON.name, version: corePackageJSON.version },
    browsers,
    defaultChannel,
    dirs: { stateRoot: stateRoot(), daemon: daemonRoot(), profiles: profilesDir(), servers: serverRegistryDir(), sockets: socketsDir(), workspace },
    config: { global: globalFile, globalExists: fs.existsSync(globalFile), project: projectFile, projectExists: fs.existsSync(projectFile) },
    sessions,
    timezoneStrategy: process.platform === 'win32' ? 'CDP Emulation.setTimezoneOverride (no per-process TZ on Windows)' : 'TZ environment variable of the browser process',
    issues,
  };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = [
    '### patchright-cli doctor',
    `- cli: ${report.cli.name} ${report.cli.version}`,
    `- core: ${report.core.name} ${report.core.version}`,
    `- node: ${report.node} on ${report.platform}`,
    `- browsers:`,
    ...report.browsers.map(b => `  - ${b.channel}: ${b.executablePath ?? '(not installed)'}${b.channel === report.defaultChannel ? '  <- default' : ''}`),
    `- state root: ${report.dirs.stateRoot}`,
    `- workspace: ${report.dirs.workspace ?? '(none; run `patchright-cli install` to create one)'}`,
    `- global config: ${report.config.global}${report.config.globalExists ? '' : ' (absent)'}`,
    `- project config: ${report.config.project}${report.config.projectExists ? '' : ' (absent)'}`,
    `- timezone strategy: ${report.timezoneStrategy}`,
    `- sessions: ${report.sessions.length ? report.sessions.map(s => `${s.name} (${s.open ? 'open' : 'closed'})`).join(', ') : '(none)'}`,
  ];
  if (report.issues.length) {
    lines.push('', '### Issues');
    lines.push(...report.issues.map(issue => `- ${issue}`));
  } else {
    lines.push('', 'No issues found.');
  }
  return lines.join('\n');
}

export const doctorCommand: ClientCommand = {
  name: 'doctor',
  async run(ctx) {
    const report = await collectDoctorReport(ctx);
    ctx.output.toolResult(ctx.output.json ? JSON.stringify(report, null, 2) : renderDoctorReport(report));
    if (report.issues.length)
      process.exitCode = 1;
  },
};

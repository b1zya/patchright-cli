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

// Forked from playwright-core/src/tools/cli-client/program.ts (v1.62.1).

/* eslint-disable no-restricted-properties */

import { spawn } from 'child_process';

import { readState } from './humanize/state';
import { describeLifetime, describeLifetimeNote, removeLifetimeFiles, resolveLifetime, runWatchdog, startWatchdog, stopWatchdog, touchActivity, watchdogCommand } from './lifetime';

import fs from 'fs';
import path from 'path';

import { isKnownChannel, listChannelSessions } from './channelSessions';
import { JsonOutput, TextOutput } from './output';
import { clientKey, createClientInfo, explicitSessionName, Registry, resolveSessionName } from './registry';
import { Session } from './session';
import { coreBundle, corePackageJSON, dashboardAppPath, serverRegistry, utilsBundle } from './core';
import { loadUserConfig } from './config/load';
import { applyCoreEnvInProcess, coreProcessEnv } from './daemonEnv';
import { loadHelp } from './help';
import { killAllDaemons } from './killAll';
import { bundledSkillDir, parseSkillTarget, skillInstallDir, workspaceMarker } from './paths';
import { stealth } from './stealth';
import { minimist } from './args';

import type { InstallResult, ListData, ListedBrowser, Output } from './output';
import type { ClientInfo, SessionFile } from './registry';
import type { MinimistArgs } from './args';
import type { CommandContext } from './stealth';

type GlobalOptions = {
  help?: boolean;
  json?: boolean;
  raw?: boolean;
  session?: string;
  version?: boolean;
};

type AttachOptions = {
  config?: string;
  cdp?: string;
  endpoint?: string;
  extension?: boolean | string;
};

type OpenOptions = {
  browser?: string;
  config?: string;
  device?: string;
  headed?: boolean;
  mobile?: boolean;
  persistent?: boolean;
  profile?: string;
};

const globalOptions: (keyof (GlobalOptions & OpenOptions & AttachOptions))[] = [
  'json',
  'raw',
  'session',
];

const booleanOptions: string[] = [
  'all',
  'headless-user-agent',
  'help',
  'json',
  'raw',
  'version',
  'headful', // alias for --headed; keep it a boolean so it never swallows the next arg
  'g', // alias for --global, normalized above; boolean so it never swallows the next arg
];

export async function program(options?: { embedderVersion?: string }) {
  const clientInfo = createClientInfo();
  const help = loadHelp();

  const argv = process.argv.slice(2);
  const boolean = [...help.booleanOptions, ...booleanOptions];
  const args: MinimistArgs = minimist(argv, { boolean, string: ['_'] });
  // Normalize -s alias to --session
  if (args.s) {
    args.session = args.s;
    delete args.s;
  }
  // Normalize -g alias to --global
  if (args.g) {
    args.global = true;
    delete args.g;
  }

  const output: Output = args.json ? new JsonOutput() : new TextOutput();
  const commandName = args._?.[0];

  if (args.version || args.v) {
    output.version({
      version: options?.embedderVersion ?? clientInfo.version,
      core: { name: corePackageJSON.name, version: corePackageJSON.version },
    });
    process.exit(0);
  }

  // The session watchdog (src/lifetime.ts) runs as a hidden subcommand of this same binary.
  if (commandName === watchdogCommand) {
    await runWatchdog(args);
    return;
  }

  const command = commandName && help.commands[commandName];
  if (args.help || args.h || !commandName) {
    if (command) {
      output.help(command.help);
    } else {
      const lines = [`patchright-cli - anti-detection browser automation for AI agents (${corePackageJSON.name} ${corePackageJSON.version})`];
      if (process.env.CLAUDECODE || process.env.COPILOT_CLI)
        lines.push(`Agent skill: ${path.relative(process.cwd(), path.join(bundledSkillDir(), 'SKILL.md'))}`);
      lines.push(help.global);
      output.help(lines.join('\n\n'));
    }
    process.exit(0);
  }

  if (!command)
    output.errorUnknownCommand(commandName, help.global);

  validateFlags(args, command, output);
  validateArgs(args, command, output);

  const registry = await Registry.load();
  const sessionName = resolveSessionName(args.session as string);

  switch (commandName) {
    case 'list': {
      const data = await collectList(registry, clientInfo, !!args.all);
      output.list(data);
      return;
    }
    case 'close-all': {
      const entries = registry.entries(clientInfo);
      const closed: string[] = [];
      for (const entry of entries) {
        await new Session(entry).stop();
        stopWatchdog(clientInfo, entry.config.name);
        closed.push(entry.config.name);
      }
      output.closeAll(closed);
      return;
    }
    case 'delete-data': {
      const entry = registry.entry(clientInfo, sessionName);
      if (!entry) {
        output.deleteData(sessionName, { existed: false, deletedUserDataDir: false });
        return;
      }
      const result = await new Session(entry).deleteData();
      stopWatchdog(clientInfo, sessionName);
      removeLifetimeFiles(clientInfo.daemonProfilesDir, sessionName);
      output.deleteData(sessionName, result);
      return;
    }
    case 'kill-all': {
      const pids = await killAllDaemons();
      output.killAll(pids);
      return;
    }
    case 'open': {
      const { pid, launch } = await startSession(sessionName, registry, clientInfo, args, 'open', output);
      const newEntry = await registry.loadEntry(clientInfo, sessionName);
      const params = args._.slice(1);
      const toolText = await runInSessionOrStop(newEntry, clientInfo, { _: ['goto', ...(params.length ? params : ['about:blank'])] }, output);
      output.open(sessionName, pid, toolText, launch);
      return;
    }
    case 'attach': {
      const attachTarget = args._[1] as string | undefined;
      const targetCount = (attachTarget ? 1 : 0) + (args.cdp ? 1 : 0) + (args.endpoint ? 1 : 0) + (args.extension ? 1 : 0);
      if (targetCount > 1)
        output.errorAttachConflict();
      if (attachTarget)
        args.endpoint = attachTarget;
      const extensionChannel = typeof args.extension === 'string' ? args.extension : undefined;
      if (extensionChannel) {
        args.browser = extensionChannel;
        args.extension = true;
      }

      const cdpChannel = typeof args.cdp === 'string' && isKnownChannel(args.cdp) ? args.cdp : undefined;
      const targetName = attachTarget ?? cdpChannel ?? extensionChannel ?? args.endpoint as string ?? args.cdp as string;
      if (!targetName)
        output.errorAttachNoTarget();
      const attachSessionName = explicitSessionName(args.session as string) ?? attachTarget ?? cdpChannel ?? extensionChannel ?? sessionName;
      args.session = attachSessionName;
      const { pid } = await startSession(attachSessionName, registry, clientInfo, args, 'attach', output);
      const newEntry = await registry.loadEntry(clientInfo, attachSessionName);
      const toolText = await runInSessionOrStop(newEntry, clientInfo, { _: ['snapshot'], filename: '<auto>' }, output);
      output.attach(attachSessionName, pid, targetName, toolText);
      return;
    }
    case 'close': {
      const closeEntry = registry.entry(clientInfo, sessionName);
      const { wasOpen } = closeEntry ? await new Session(closeEntry).stop() : { wasOpen: false };
      stopWatchdog(clientInfo, sessionName);
      output.close(sessionName, wasOpen);
      return;
    }
    case 'detach': {
      const detachEntry = registry.entry(clientInfo, sessionName);
      if (detachEntry && !detachEntry.config.attached)
        output.errorDetachNotAttached(sessionName);
      const { wasOpen } = detachEntry ? await new Session(detachEntry).stop() : { wasOpen: false };
      stopWatchdog(clientInfo, sessionName);
      output.detach(sessionName, wasOpen);
      return;
    }
    case 'install':
      // --global only decides where the skill goes, so it means nothing on its own.
      if (args.global && !args.skills)
        output.errorInstallGlobalRequiresSkills();
      output.installed(await installWorkspace(args, clientInfo));
      return;
    case 'install-browser':
      // The installer prints its own progress.
      await installBrowser();
      return;
    case 'show': {
      const daemonArgs = [
        dashboardAppPath,
        `--workspaceDir=${clientInfo.workspaceDir ?? ''}`,
      ];
      // Only pass --sessionName when the user explicitly requested a session
      // (via -s/--session or the session env var). Bare `show` opens the
      // dashboard generically, with no specific session to reveal, so the
      // daemon should ack as soon as it's ready rather than waiting for a
      // reveal that was never asked for.
      const explicit = explicitSessionName(args.session as string);
      if (explicit)
        daemonArgs.push(`--sessionName=${explicit}`);
      if (args.port !== undefined)
        daemonArgs.push(`--port=${args.port}`);
      if (args.host !== undefined)
        daemonArgs.push(`--host=${args.host as string}`);
      if (args.kill) {
        daemonArgs.push(`--kill`);
        const child = spawn(process.execPath, daemonArgs, { stdio: 'ignore', env: coreProcessEnv(), windowsHide: true });
        await new Promise<void>(resolve => child.on('exit', () => resolve()));
        return;
      }
      if (args.annotate) {
        const entry = registry.entry(clientInfo, sessionName);
        if (!entry)
          output.errorBrowserNotOpenForTool(sessionName);
        args.raw = true;
        const text = await runInSession(entry, clientInfo, args, output);
        output.toolResult(text);
        return;
      }
      const foreground = args.port !== undefined;
      const child = spawn(process.execPath, daemonArgs, {
        detached: !foreground,
        stdio: foreground ? 'inherit' : ['pipe', 'pipe', 'ignore'],
        env: coreProcessEnv(),
        windowsHide: true,
      });
      if (foreground) {
        await new Promise<void>(resolve => child.on('exit', () => resolve()));
        return;
      }
      const timer = setTimeout(() => child.stdin!.destroy(), 60_000);
      child.unref();
      let daemonPid: number;
      try {
        await new Promise<void>((resolve, reject) => {
          let outLog = '';
          child.stdout!.on('data', data => {
            outLog += data.toString();
            const match = outLog.match(/Dashboard is running pid=(\d+)/);
            if (match) {
              daemonPid = Number(match[1]);
              resolve();
            }
          });
          child.once('exit', (code, signal) => reject(new Error(`Dashboard daemon exited (code=${code}, signal=${signal}) before signaling READY${outLog ? '\n' + outLog : ''}`)));
        });
      } finally {
        clearTimeout(timer);
        child.removeAllListeners('exit');
        child.stdin!.destroy();
        child.stdout!.destroy();
      }
      output.show(sessionName, daemonPid!);
      return;
    }
    default: {
      const ctx = commandContext(args, sessionName, clientInfo, registry, output);
      const clientCommand = stealth.extraCommands.find(c => c.name === commandName);
      if (clientCommand) {
        await clientCommand.run(ctx);
        return;
      }

      const guard = stealth.guardCommand(commandName, args, ctx);
      for (const warning of guard.warnings ?? [])
        output.warn(warning);
      if (guard.kind === 'deny')
        output.errorDenied(guard.message);

      const runArgs = guard.kind === 'rewrite' ? guard.args : args;
      const raw = guard.kind === 'rewrite' ? (guard.raw ?? command.raw) : command.raw;
      for (const flag of stealth.clientOnlyFlags)
        delete runArgs[flag];

      const entry = registry.entry(clientInfo, sessionName);
      if (!entry)
        output.errorBrowserNotOpenForTool(sessionName);
      if (raw)
        runArgs.raw = true;
      const text = await runInSession(entry, clientInfo, runArgs, output);
      if (guard.kind !== 'rewrite') {
        output.toolResult(text);
        return;
      }
      guard.onResult?.(text);
      if (!guard.silent)
        output.toolResult(text);
      for (const next of guard.then ?? [])
        output.toolResult(await runInSession(entry, clientInfo, next, output));
    }
  }
}

async function startSession(sessionName: string, registry: Registry, clientInfo: ClientInfo, args: MinimistArgs, mode: 'open' | 'attach', output: Output) {
  const entry = registry.entry(clientInfo, sessionName);
  if (entry)
    await new Session(entry).stop();
  stopWatchdog(clientInfo, sessionName);

  const cwd = process.cwd();
  const loaded = loadUserConfig({ cwd, workspaceDir: clientInfo.workspaceDir, sessionName, explicitPath: args.config as string | undefined });
  for (const message of loaded.warnings)
    output.warn({ key: 'config', severity: 'LOW', kind: 'notice', message });
  // Resolved before the launch so a bad --idle-timeout/--owner-pid never leaves a daemon behind.
  const lifetime = resolveLifetime(args, loaded.config, process.env);

  const profile = await stealth.resolveLaunchProfile({
    mode,
    sessionName,
    cwd,
    workspaceDir: clientInfo.workspaceDir,
    args,
    userConfig: loaded.config,
    daemonProfilesDir: clientInfo.daemonProfilesDir,
  });
  for (const warning of profile.warnings)
    output.warn(warning);

  const started = await Session.startDaemon(clientInfo, { sessionName, daemonFlags: profile.daemonFlags, daemonConfig: profile.daemonConfig, env: profile.env });
  touchActivity(clientInfo.daemonProfilesDir, sessionName);
  if (lifetime.idleMs || lifetime.ownerPid) {
    const newEntry = await registry.loadEntry(clientInfo, sessionName);
    startWatchdog(clientInfo, sessionName, lifetime, started.pid, newEntry.config.timestamp);
    // Say so when the lifetime was not asked for explicitly: an agent should know the
    // browser will go away, and how to keep it.
    if (lifetime.idleSource === 'agent-default' || lifetime.ownerSource === 'env')
      output.warn({ key: 'lifetime', severity: 'INFO', kind: 'notice', message: describeLifetimeNote(lifetime) });
  }
  return { ...started, launch: profile.launch };
}

function commandContext(args: MinimistArgs, sessionName: string, clientInfo: ClientInfo, registry: Registry, output: Output): CommandContext {
  return {
    args,
    sessionName,
    clientInfo,
    registry,
    output,
    userConfig: loadUserConfig({ cwd: process.cwd(), workspaceDir: clientInfo.workspaceDir, sessionName }).config,
    async runInSession(runArgs: MinimistArgs, options?: { raw?: boolean, json?: boolean }): Promise<string> {
      const entry = registry.entry(clientInfo, sessionName);
      if (!entry)
        output.errorBrowserNotOpenForTool(sessionName);
      if (options?.raw)
        runArgs.raw = true;
      // `json: false` lets a client command probe the page in text mode while the user asked for --json.
      return await runInSession(entry, clientInfo, runArgs, output, options?.json);
    },
  };
}

async function runInSession(entry: SessionFile, clientInfo: ClientInfo, args: MinimistArgs, output: Output, json?: boolean): Promise<string> {
  const raw = !!args.raw;
  for (const globalOption of globalOptions)
    delete args[globalOption];
  const session = new Session(entry);
  touchActivity(entry.daemonDir, entry.config.name);
  const result = await session.run(clientInfo, args, { raw, json: json ?? output.json });
  // Tool errors are reported in the text; surface them through the exit code as well.
  if (result.isError)
    process.exitCode = 1;
  return result.text;
}

// Used by `open` / `attach` after `startSession`: if the implicit goto/snapshot
// fails post-spawn (e.g. tool runtime error), stop the freshly-spawned daemon
// so we don't strand a detached browser. Pre-spawn arg validation lives in
// `validateArgs`; this is a defense-in-depth backstop for runtime errors.
async function runInSessionOrStop(entry: SessionFile, clientInfo: ClientInfo, args: MinimistArgs, output: Output): Promise<string> {
  try {
    return await runInSession(entry, clientInfo, args, output);
  } catch (e) {
    await new Session(entry).stop().catch(() => {});
    throw e;
  }
}

// Unlike upstream, `install` never spawns the daemon's --init-workspace: that would install
// the playwright-cli skill and silently download a browser. It only creates the workspace
// marker the daemon looks for and copies our own skill when --skills is given.
async function installWorkspace(args: MinimistArgs, clientInfo: ClientInfo): Promise<InstallResult> {
  const workspaceDir = clientInfo.workspaceDir ?? process.cwd();
  const markerDir = path.join(workspaceDir, workspaceMarker);
  await fs.promises.mkdir(markerDir, { recursive: true });
  const result: InstallResult = { workspaceDir };
  if (args.skills) {
    const target = parseSkillTarget(args.skills);
    const root = args.global ? clientInfo.homeDir : workspaceDir;
    const skillDir = skillInstallDir(target, root);
    await fs.promises.rm(skillDir, { recursive: true, force: true });
    await fs.promises.cp(bundledSkillDir(), skillDir, { recursive: true });
    result.skillDir = skillDir;
  }
  return result;
}

async function installBrowser() {
  const argv = process.argv.map(arg => arg === 'install-browser' ? 'install' : arg);
  const { libCli } = coreBundle();
  const { program } = utilsBundle();
  if (!program.version())
    libCli.decorateProgram(program);
  program.parse(argv);
}

function describeLifetimeOf(daemonDir: string, sessionName: string): string | undefined {
  const lifetime = readState(daemonDir, sessionName).lifetime;
  return lifetime ? describeLifetime(lifetime) : undefined;
}

async function collectList(registry: Registry, clientInfo: ClientInfo, all: boolean): Promise<ListData> {
  const browsers: ListedBrowser[] = [];
  const entries = registry.entryMap();

  // List early to GC. The server registry reads its directory from the environment.
  if (all)
    applyCoreEnvInProcess();
  const serverEntries = all ? await serverRegistry().list() : new Map();
  const key = clientKey(clientInfo);
  for (const [workspaceKey, list] of entries) {
    if (!all && workspaceKey !== key)
      continue;
    for (const entry of list) {
      const session = new Session(entry);
      const canConnect = await session.canConnect();
      if (!canConnect) {
        await session.deleteSessionConfig();
        continue;
      }
      const config = session.config;
      const channel = config.browser?.launchOptions.channel ?? config.browser?.browserName;
      browsers.push({
        name: session.name,
        workspace: workspaceKey,
        status: canConnect ? 'open' : 'closed',
        browserType: channel,
        userDataDir: config.browser?.userDataDir ?? null,
        headed: config.browser ? !config.browser.launchOptions.headless : undefined,
        persistent: !!config.cli.persistent,
        attached: !!config.attached,
        compatible: session.isCompatible(clientInfo),
        version: config.version,
        lifetime: describeLifetimeOf(entry.daemonDir, session.name),
      });
    }
  }

  if (!all)
    return { all, browsers };

  const servers = [...serverEntries.values()].flat();
  return { all, browsers, servers, channelSessions: await listChannelSessions() };
}

function validateFlags(args: MinimistArgs, command: { flags: Record<string, 'boolean' | 'string'>, help: string }, output: Output) {
  const unknownFlags: string[] = [];
  for (const key of Object.keys(args)) {
    if (key === '_')
      continue;
    if ((globalOptions as readonly string[]).includes(key))
      continue;
    if (stealth.clientOnlyFlags.includes(key))
      continue;
    if (!(key in command.flags))
      unknownFlags.push(key);
  }
  if (unknownFlags.length)
    output.errorUnknownOption(unknownFlags, command.help);
}

function validateArgs(args: MinimistArgs, command: { args: string[], help: string, variadicArg?: boolean }, output: Output) {
  const positional = args._.slice(1);
  if (!command.variadicArg && positional.length > command.args.length)
    output.errorTooManyArguments(command.args.length, positional.length, command.help);
}

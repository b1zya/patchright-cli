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

// The upstream layer. Two upstreams feed this repository:
//   - patchright-core (npm): the daemon we run untouched, and the compiled client our
//     src/*.ts were forked from. Its TypeScript is not in the package; it is the Playwright
//     source at the tag whose compiled cli-client is byte-identical to the package, which
//     `matchPlaywrightVersion` finds by comparing the compiled files.
//   - microsoft/playwright-cli (git): the thin CLI repository this fork descends from.
// The pristine copies of everything we forked live under vendor/ (never edited by hand);
// src/ is our layer on top. A roll is a three-way merge: vendor (base) -> new upstream
// (theirs) applied onto src (ours) with `git merge-file`, so upstream changes land in our
// files and any overlap with our changes is a conflict that stops the roll instead of
// silently overwriting either side. scripts/upstream-snapshot/versions.json records what
// the repository is based on.

import { execFileSync, execSync, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

export const root = path.resolve(__dirname, '..', '..');
export const rollDir = path.join(root, '.roll');
export const snapshotDir = path.join(root, 'scripts', 'upstream-snapshot');
export const versionsFile = path.join(snapshotDir, 'versions.json');
export const clientPatchFile = path.join(snapshotDir, 'client.patch');

export const playwrightRepo = 'microsoft/playwright';
export const playwrightCliRepo = 'microsoft/playwright-cli';
export const playwrightCliUrl = `https://github.com/${playwrightCliRepo}`;
export const cliClientUpstreamDir = 'packages/playwright-core/src/tools/cli-client';

export type ForkedFile = { name: string, upstream: string, vendor: string, ours: string };

// What src/ was forked from, file by file. Upstream names are kept (minimist.ts is our
// args.ts). package.ts and cliDaemon.ts exist upstream but are not forked: the daemon is
// run from node_modules and core.ts replaces package.ts.
export const forkedFiles: ForkedFile[] = [
  ...['program', 'session', 'registry', 'output', 'channelSessions', 'cli'].map(name => ({
    name: `${name}.ts`,
    upstream: `${cliClientUpstreamDir}/${name}.ts`,
    vendor: `vendor/cli-client/${name}.ts`,
    ours: `src/${name}.ts`,
  })),
  { name: 'minimist.ts', upstream: `${cliClientUpstreamDir}/minimist.ts`, vendor: 'vendor/cli-client/minimist.ts', ours: 'src/args.ts' },
  { name: 'socketConnection.ts', upstream: 'packages/playwright-core/src/tools/utils/socketConnection.ts', vendor: 'vendor/cli-client/socketConnection.ts', ours: 'src/socketConnection.ts' },
];
export const notForkedUpstreamFiles = ['package.ts', 'cliDaemon.ts'];

// microsoft/playwright-cli: the one file we still carry a modified copy of, plus the files
// whose upstream changes are worth reading but never merged (we rewrote them).
export const playwrightCliFiles: ForkedFile[] = [
  { name: 'integration.spec.ts', upstream: 'tests/integration.spec.ts', vendor: 'vendor/playwright-cli/tests/integration.spec.ts', ours: 'tests/integration/core.spec.ts' },
];
export const playwrightCliReportOnly = [
  '.claude/skills/dev/SKILL.md', '.claude/skills/dev/roll.md', '.claude/skills/dev/release.md',
  'README.md', 'CONTRIBUTING.md', 'CLAUDE.md', 'package.json', 'playwright-cli.js', 'skillCheck.js', 'scripts/update.js',
  '.github/workflows/ci.yml', 'playwright.config.ts',
];

export type Versions = {
  patchrightCore: {
    version: string;
    playwrightVersion: string;
    playwrightTag: string;
    rolledAt: string;
    vendorSha256: Record<string, string>;
  };
  playwrightCli: {
    repository: string;
    commit: string;
    date?: string;
    trackedAt: string;
    vendorSha256: Record<string, string>;
  };
};

export const lf = (text: string): string => text.replace(/\r\n/g, '\n');

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(lf(text)).digest('hex');
}

export function readVersions(): Versions {
  return JSON.parse(fs.readFileSync(versionsFile, 'utf8'));
}

export function writeVersions(versions: Versions): void {
  fs.writeFileSync(versionsFile, JSON.stringify(versions, null, 2) + '\n');
}

export function vendorHashes(files: ForkedFile[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of files) {
    const full = path.join(root, file.vendor);
    if (fs.existsSync(full))
      hashes[file.vendor] = sha256(fs.readFileSync(full, 'utf8'));
  }
  return hashes;
}

export function readRepoFile(relative: string): string | undefined {
  const full = path.join(root, relative);
  return fs.existsSync(full) ? lf(fs.readFileSync(full, 'utf8')) : undefined;
}

export function writeRepoFile(relative: string, text: string): void {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, lf(text));
}

// ---- npm ----

export function npm(args: string): string {
  return execSync(`npm ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

export function npmVersions(name: string): string[] {
  return JSON.parse(npm(`view ${name} versions --json`));
}

export function npmLatest(name: string): string {
  return npm(`view ${name} version`);
}

export function npmPublishTime(name: string, version: string): Date | undefined {
  try {
    const times = JSON.parse(npm(`view ${name} time --json`));
    return times[version] ? new Date(times[version]) : undefined;
  } catch {
    return undefined;
  }
}

export function semverGreater(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0))
      return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

// Minimal ustar/PAX reader: enough for npm tarballs, and independent of whichever `tar`
// happens to be on PATH (Git Bash's GNU tar treats `C:\...` as a remote host).
export function extractTgz(file: string, destination: string): void {
  const data = zlib.gunzipSync(fs.readFileSync(file));
  let offset = 0;
  let paxPath: string | undefined;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0))
      break;
    const field = (start: number, length: number) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    const name = paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    paxPath = undefined;
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const match = body.toString('utf8').match(/^\d+ path=(.*)$/m);
      paxPath = match?.[1];
      continue;
    }
    if (type !== '0' && type !== '')
      continue;
    const target = path.join(destination, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
}

export function fetchNpmPackage(name: string, version: string, dir: string): string {
  const packageDir = path.join(dir, 'package');
  if (fs.existsSync(path.join(packageDir, 'package.json')))
    return packageDir;
  fs.mkdirSync(dir, { recursive: true });
  const tarball = npm(`pack ${name}@${version} --pack-destination "${dir}"`).split('\n').pop()!;
  extractTgz(path.join(dir, tarball), dir);
  return packageDir;
}

// ---- GitHub ----

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'user-agent': 'patchright-cli-upstream-tools' };
  if (process.env.GITHUB_TOKEN)
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

export async function fetchText(url: string, timeoutMs = 30000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: githubHeaders(), signal: controller.signal });
    if (!response.ok)
      throw Object.assign(new Error(`${url}: HTTP ${response.status}`), { status: response.status });
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTextOrUndefined(url: string): Promise<string | undefined> {
  try {
    return await fetchText(url);
  } catch (e: any) {
    if (e.status === 404)
      return undefined;
    throw e;
  }
}

export async function fetchJson<T = any>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url));
}

export function githubRawUrl(repo: string, ref: string, filePath: string): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${filePath}`;
}

export async function githubListDir(repo: string, ref: string, dir: string): Promise<string[]> {
  const entries = await fetchJson<{ type: string, name: string }[]>(`https://api.github.com/repos/${repo}/contents/${dir}?ref=${ref}`);
  return entries.filter(entry => entry.type === 'file').map(entry => entry.name);
}

export type CompareResult = {
  status: string;
  total_commits: number;
  commits: { sha: string, commit: { message: string, committer: { date: string } } }[];
  files?: { filename: string, status: string, additions: number, deletions: number, patch?: string }[];
};

export async function githubCompare(repo: string, base: string, head: string): Promise<CompareResult> {
  return fetchJson<CompareResult>(`https://api.github.com/repos/${repo}/compare/${base}...${head}`);
}

export function gitLsRemoteHead(url: string): string {
  const output = execFileSync('git', ['ls-remote', url, 'HEAD'], { encoding: 'utf8' });
  const sha = output.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha))
    throw new Error(`git ls-remote ${url}: unexpected output ${output}`);
  return sha;
}

// ---- which Playwright tag was this patchright-core compiled from? ----

export function isStable(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

// patchright-core re-releases under its own patch number (1.62.3 wraps Playwright 1.62.1),
// so the candidates are the stable Playwright versions with the same major.minor and a
// patch number no higher than patchright's, newest first.
export function candidatePlaywrightVersions(patchrightVersion: string, all: string[]): string[] {
  const [major, minor, patch] = patchrightVersion.split('.').map(Number);
  return all
      .filter(isStable)
      .map(version => version.split('.').map(Number))
      .filter(([a, b, c]) => a === major && b === minor && c <= patch)
      .sort((a, b) => b[2] - a[2])
      .map(parts => parts.join('.'));
}

export function differingCompiledFiles(dirA: string, dirB: string, files: string[]): string[] {
  return files.filter(file => {
    const a = path.join(dirA, file);
    const b = path.join(dirB, file);
    if (!fs.existsSync(a) || !fs.existsSync(b))
      return true;
    return !fs.readFileSync(a).equals(fs.readFileSync(b));
  });
}

export type PlaywrightMatch = { version: string, tag: string, tried: string[] };

export function matchPlaywrightVersion(patchrightDir: string, patchrightVersion: string, files: string[], deps: { versions: string[], fetchPackage: (version: string) => string }): PlaywrightMatch | undefined {
  const tried: string[] = [];
  for (const candidate of candidatePlaywrightVersions(patchrightVersion, deps.versions)) {
    tried.push(candidate);
    if (differingCompiledFiles(patchrightDir, deps.fetchPackage(candidate), files).length === 0)
      return { version: candidate, tag: `v${candidate}`, tried };
  }
  return undefined;
}

// ---- three-way merge ----

export type MergeStatus = 'unchanged' | 'upstream-only' | 'clean' | 'conflict' | 'removed-upstream';
export type MergeResult = { status: MergeStatus, text: string, conflicts: number };

// ours = src (our layer), base = vendor (pristine at the current version), theirs = pristine
// at the target version. `git merge-file` returns the number of conflicts as its exit code.
export function mergeThreeWay(ours: string, base: string, theirs: string | undefined, labels = { ours: 'ours', base: 'base', theirs: 'upstream' }): MergeResult {
  const o = lf(ours);
  const b = lf(base);
  if (theirs === undefined)
    return { status: 'removed-upstream', text: o, conflicts: 0 };
  const t = lf(theirs);
  if (b === t || o === t)
    return { status: 'unchanged', text: o, conflicts: 0 };
  if (o === b)
    return { status: 'upstream-only', text: t, conflicts: 0 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchright-cli-merge-'));
  try {
    const files = { ours: path.join(dir, 'ours'), base: path.join(dir, 'base'), theirs: path.join(dir, 'theirs') };
    fs.writeFileSync(files.ours, o);
    fs.writeFileSync(files.base, b);
    fs.writeFileSync(files.theirs, t);
    const result = spawnSync('git', ['merge-file', '-p', '-L', labels.ours, '-L', labels.base, '-L', labels.theirs, files.ours, files.base, files.theirs], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error)
      throw result.error;
    if (result.status === null || result.status < 0 || result.status > 127)
      throw new Error(`git merge-file failed (${result.status}): ${result.stderr}`);
    return { status: result.status === 0 ? 'clean' : 'conflict', text: result.stdout, conflicts: result.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export type FileMerge = { file: ForkedFile, status: MergeStatus, conflicts: number, merged: string };

export function mergeForkedFiles(files: ForkedFile[], read: { ours: (file: ForkedFile) => string, base: (file: ForkedFile) => string, theirs: (file: ForkedFile) => string | undefined }): FileMerge[] {
  return files.map(file => {
    const result = mergeThreeWay(read.ours(file), read.base(file), read.theirs(file), { ours: file.ours, base: file.vendor, theirs: `upstream ${file.upstream}` });
    return { file, status: result.status, conflicts: result.conflicts, merged: result.text };
  });
}

// ---- verdicts and reports ----

export type Classification = 'safe' | 'review' | 'blocked';

export type RollAnalysis = {
  current: string;
  target: string;
  publishedAt?: string;
  ageHours?: number;
  playwright?: PlaywrightMatch;
  triedPlaywright: string[];
  compiledChanged: string[];
  commandsAdded: string[];
  commandsRemoved: string[];
  daemonOptionsDelta: string[];
  missingHooks: string[];
  skillChanged: boolean;
  upstreamAdded: string[];
  upstreamRemoved: string[];
  merges: FileMerge[];
};

export function classifyRoll(a: RollAnalysis): { classification: Classification, reasons: string[] } {
  const blockers: string[] = [];
  if (!a.playwright)
    blockers.push(`no stable Playwright release compiles to this patchright-core client (tried ${a.triedPlaywright.join(', ') || 'none'}); the pristine sources cannot be located, so the merge base is unknown`);
  for (const merge of a.merges) {
    if (merge.status === 'conflict')
      blockers.push(`${merge.file.ours}: ${merge.conflicts} conflict(s) between our changes and upstream changes`);
  }
  if (a.missingHooks.length)
    blockers.push(`environment hooks missing from coreBundle.js: ${a.missingHooks.join(', ')} (state isolation depends on them)`);
  if (blockers.length)
    return { classification: 'blocked', reasons: blockers };

  const review: string[] = [];
  if (a.compiledChanged.length)
    review.push(`upstream client files changed: ${a.compiledChanged.join(', ')}`);
  if (a.commandsAdded.length)
    review.push(`new commands: ${a.commandsAdded.join(', ')} (document in the skill, decide on guards)`);
  if (a.commandsRemoved.length)
    review.push(`removed commands: ${a.commandsRemoved.join(', ')} (drop from the skill and the overlay)`);
  if (a.daemonOptionsDelta.length)
    review.push(`daemon flags changed: ${a.daemonOptionsDelta.join(' ')} (Session.daemonArgs, launch profile)`);
  if (a.skillChanged)
    review.push('the upstream skill changed; compare it with skills/patchright-cli');
  if (a.upstreamAdded.length)
    review.push(`new upstream client files not forked here: ${a.upstreamAdded.join(', ')}`);
  if (a.upstreamRemoved.length)
    review.push(`upstream removed files we fork: ${a.upstreamRemoved.join(', ')}`);
  const merged = a.merges.filter(merge => merge.status === 'clean' || merge.status === 'upstream-only');
  if (merged.length)
    review.push(`upstream changes merged into: ${merged.map(merge => `${merge.file.ours} (${merge.status})`).join(', ')}`);
  if (review.length)
    return { classification: 'review', reasons: review };
  return { classification: 'safe', reasons: ['nothing our client is forked from changed; only the daemon and the patches moved'] };
}

export function renderRollReport(a: RollAnalysis, verdict: { classification: Classification, reasons: string[] }, options: { dryRun: boolean, applied: boolean }): string {
  const lines: string[] = [];
  lines.push(`# Roll patchright-core ${a.current} -> ${a.target}`, '');
  lines.push(`Verdict: **${verdict.classification}**${options.dryRun ? ' (dry run, nothing changed)' : options.applied ? ' (applied)' : ' (not applied)'}`, '');
  for (const reason of verdict.reasons)
    lines.push(`- ${reason}`);
  lines.push('');
  if (a.publishedAt)
    lines.push(`Published ${a.publishedAt}${a.ageHours !== undefined ? ` (${Math.round(a.ageHours)} h ago)` : ''}.`, '');
  lines.push(`Playwright sources: ${a.playwright ? `${a.playwright.tag} (compiled client byte-identical; tried ${a.playwright.tried.join(', ')})` : 'NOT FOUND'}`, '');
  lines.push('## Forked files (three-way merge: src <- vendor -> upstream)', '');
  lines.push('| file | result |', '|---|---|');
  for (const merge of a.merges)
    lines.push(`| ${merge.file.ours} | ${merge.status}${merge.conflicts ? ` (${merge.conflicts})` : ''} |`);
  if (!a.merges.length)
    lines.push('| (none) | merge base unknown |');
  lines.push('');
  lines.push('## Compiled files that changed', '', a.compiledChanged.length ? a.compiledChanged.map(f => `- ${f}`).join('\n') : '- none', '');
  const surface = [
    a.commandsAdded.length ? `commands added: ${a.commandsAdded.join(', ')}` : '',
    a.commandsRemoved.length ? `commands removed: ${a.commandsRemoved.join(', ')}` : '',
    a.daemonOptionsDelta.length ? `daemon flags: ${a.daemonOptionsDelta.join(' ')}` : '',
    a.skillChanged ? 'bundled skill changed' : '',
    a.upstreamAdded.length ? `new upstream client files: ${a.upstreamAdded.join(', ')}` : '',
    a.upstreamRemoved.length ? `removed upstream client files: ${a.upstreamRemoved.join(', ')}` : '',
    a.missingHooks.length ? `MISSING environment hooks: ${a.missingHooks.join(', ')}` : '',
  ].filter(Boolean);
  lines.push('## Command surface and daemon', '', surface.length ? surface.map(s => `- ${s}`).join('\n') : '- unchanged', '');
  return lines.join('\n');
}

// ---- roll-side workspace (.roll/, ignored by git) ----

export function writeRollArtifact(name: string, text: string): string {
  fs.mkdirSync(rollDir, { recursive: true });
  const full = path.join(rollDir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

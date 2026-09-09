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

// Rolls the patchright-core pin and carries our client layer forward.
//
//   tsx scripts/roll.ts [version|latest] [--dry-run] [--json] [--force] [--min-age-hours N]
//   tsx scripts/roll.ts <version> --resolved  the conflicts were ported into src/ by hand
//   tsx scripts/roll.ts --check [--json]      is there a newer release, and is it old enough?
//   tsx scripts/roll.ts --verify              vendor/ and the pin still match upstream (network)
//
// A roll (see scripts/upstream/lib.ts for the model):
//   1. downloads the current and the target patchright-core and diffs the compiled files
//      our client is forked from, the command list, the daemon flags, the PWTEST_* hooks;
//   2. finds the Playwright tag whose compiled client is byte-identical to the target and
//      fetches the pristine TypeScript of every forked file at that tag;
//   3. three-way merges each forked file: src (ours) <- vendor (base) -> upstream (theirs);
//   4. classifies: `safe` (nothing we fork changed), `review` (merged cleanly but the client
//      surface moved; a human reads the PR), `blocked` (a conflict, no merge base, or a
//      missing hook: nothing is written, the conflicted merges go to .roll/conflicts/);
//   5. unless --dry-run or blocked: writes src/ and vendor/, bumps the pins, installs,
//      regenerates the help, refreshes the snapshot, versions.json and client.patch.
// Exit codes: 0 done or dry run, 2 blocked, 1 error. `.roll/result.json` carries the verdict
// for CI; `.roll/report.md` is the PR body.

import fs from 'fs';
import os from 'os';
import path from 'path';

import { coreEnvHooks } from '../src/daemonEnv';
import { snapshotDir, watchedFiles } from './check-drift';
import { regenerateClientPatch } from './upstream-patch';
import {
  classifyRoll, differingCompiledFiles, fetchNpmPackage, fetchTextOrUndefined, forkedFiles, githubListDir, githubRawUrl,
  matchPlaywrightVersion, mergeForkedFiles, notForkedUpstreamFiles, npmLatest, npmPublishTime, npmVersions, playwrightRepo,
  readRepoFile, readVersions, renderRollReport, root, semverGreater, vendorHashes, writeRepoFile, writeRollArtifact, writeVersions,
  cliClientUpstreamDir, npm,
} from './upstream/lib';

import type { RollAnalysis } from './upstream/lib';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter(arg => arg.startsWith('--')));
const positional = argv.filter(arg => !arg.startsWith('--'));
const dryRun = flags.has('--dry-run');
const json = flags.has('--json');
const force = flags.has('--force');
const resolved = flags.has('--resolved');
const minAgeHours = Number(argv[argv.indexOf('--min-age-hours') + 1]) || 48;
const packageJsonPath = path.join(root, 'package.json');

function readPackageJson(): any {
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function commandNames(packageDir: string): string[] {
  const help = JSON.parse(fs.readFileSync(path.join(packageDir, 'lib', 'tools', 'cli-client', 'help.json'), 'utf8'));
  return Object.keys(help.commands);
}

function daemonOptions(packageDir: string): string[] {
  const bundle = fs.readFileSync(path.join(packageDir, 'lib', 'coreBundle.js'), 'utf8');
  const start = bundle.indexOf('function decorateCliDaemonProgram');
  const region = start === -1 ? '' : bundle.slice(start, start + 6000);
  return [...region.matchAll(/\.option\("(--[a-z-]+)/g)].map(m => m[1]);
}

// The compiled files used to identify the Playwright tag: everything we watch except the
// bundled skill (documentation, not code).
const compiledIdentity = watchedFiles.filter(file => !file.endsWith('.md'));

function ageInfo(name: string, version: string): { publishedAt?: string, ageHours?: number } {
  const published = npmPublishTime(name, version);
  if (!published)
    return {};
  return { publishedAt: published.toISOString(), ageHours: (Date.now() - published.getTime()) / 3600000 };
}

function check(): void {
  const current: string = readPackageJson().dependencies['patchright-core'];
  const latest = positional[0] && positional[0] !== 'latest' ? positional[0].replace(/^v/, '') : npmLatest('patchright-core');
  const newer = semverGreater(latest, current);
  const age = newer ? ageInfo('patchright-core', latest) : {};
  const tooFresh = newer && age.ageHours !== undefined && age.ageHours < minAgeHours && !force;
  const result = { current, latest, newer, ...age, minAgeHours, tooFresh };
  writeRollArtifact('check.json', JSON.stringify(result, null, 2) + '\n');
  if (json)
    console.log(JSON.stringify(result));
  else
    console.log(newer ? `patchright-core ${latest} is available (pinned ${current}${age.ageHours !== undefined ? `, published ${Math.round(age.ageHours)} h ago` : ''})${tooFresh ? `; younger than ${minAgeHours} h, waiting` : ''}` : `patchright-core ${current} is the latest.`);
}

async function verify(): Promise<void> {
  const versions = readVersions();
  const problems: string[] = [];
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'patchright-cli-verify-'));
  const playwrightDir = fetchNpmPackage('playwright-core', versions.patchrightCore.playwrightVersion, path.join(scratch, 'playwright-core'));
  const installed = path.join(root, 'node_modules', 'patchright-core');
  for (const file of differingCompiledFiles(installed, playwrightDir, compiledIdentity))
    problems.push(`${file}: installed patchright-core differs from playwright-core@${versions.patchrightCore.playwrightVersion}`);
  for (const file of forkedFiles) {
    const pristine = await fetchTextOrUndefined(githubRawUrl(playwrightRepo, versions.patchrightCore.playwrightTag, file.upstream));
    const vendored = readRepoFile(file.vendor);
    if (pristine === undefined)
      problems.push(`${file.upstream} does not exist at ${versions.patchrightCore.playwrightTag}`);
    else if (vendored === undefined)
      problems.push(`${file.vendor} is missing`);
    else if (pristine.replace(/\r\n/g, '\n') !== vendored)
      problems.push(`${file.vendor} differs from ${file.upstream} at ${versions.patchrightCore.playwrightTag}; vendor/ must stay pristine`);
  }
  const hashes = vendorHashes(forkedFiles);
  for (const [file, hash] of Object.entries(versions.patchrightCore.vendorSha256)) {
    if (hashes[file] !== hash)
      problems.push(`${file} does not match the hash recorded in versions.json`);
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  if (problems.length) {
    console.error('Upstream verification failed:');
    for (const problem of problems)
      console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`Verified: patchright-core ${versions.patchrightCore.version} = Playwright ${versions.patchrightCore.playwrightTag} client; vendor/ is pristine.`);
}

async function analyze(current: string, target: string): Promise<RollAnalysis> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'patchright-cli-roll-'));
  const oldDir = fetchNpmPackage('patchright-core', current, path.join(scratch, `patchright-core-${current}`));
  const newDir = fetchNpmPackage('patchright-core', target, path.join(scratch, `patchright-core-${target}`));

  const compiledChanged = differingCompiledFiles(oldDir, newDir, watchedFiles.filter(f => !f.endsWith('.md')));
  const skillChanged = differingCompiledFiles(oldDir, newDir, watchedFiles.filter(f => f.endsWith('.md'))).length > 0;
  const oldCommands = commandNames(oldDir);
  const newCommands = commandNames(newDir);
  const oldOptions = daemonOptions(oldDir);
  const newOptions = daemonOptions(newDir);
  const newBundle = fs.readFileSync(path.join(newDir, 'lib', 'coreBundle.js'), 'utf8');

  const playwrightVersions = npmVersions('playwright-core');
  const playwright = matchPlaywrightVersion(newDir, target, compiledIdentity, {
    versions: playwrightVersions,
    fetchPackage: version => fetchNpmPackage('playwright-core', version, path.join(scratch, `playwright-core-${version}`)),
  });
  const triedPlaywright = playwright?.tried ?? candidateList(target, playwrightVersions);

  let upstreamAdded: string[] = [];
  let upstreamRemoved: string[] = [];
  let merges: RollAnalysis['merges'] = [];
  if (playwright) {
    const listing = await githubListDir(playwrightRepo, playwright.tag, cliClientUpstreamDir);
    const known = new Set([...forkedFiles.map(file => file.name), ...notForkedUpstreamFiles]);
    upstreamAdded = listing.filter(name => name.endsWith('.ts') && !known.has(name));
    const theirs = new Map<string, string | undefined>();
    for (const file of forkedFiles)
      theirs.set(file.name, await fetchTextOrUndefined(githubRawUrl(playwrightRepo, playwright.tag, file.upstream)));
    upstreamRemoved = forkedFiles.filter(file => theirs.get(file.name) === undefined).map(file => file.upstream);
    merges = mergeForkedFiles(forkedFiles, {
      ours: file => readRepoFile(file.ours) ?? '',
      base: file => readRepoFile(file.vendor) ?? '',
      theirs: file => theirs.get(file.name),
    });
  }

  return {
    current,
    target,
    ...ageInfo('patchright-core', target),
    playwright,
    triedPlaywright,
    compiledChanged,
    commandsAdded: newCommands.filter(c => !oldCommands.includes(c)),
    commandsRemoved: oldCommands.filter(c => !newCommands.includes(c)),
    daemonOptionsDelta: [...newOptions.filter(o => !oldOptions.includes(o)).map(o => `+${o}`), ...oldOptions.filter(o => !newOptions.includes(o)).map(o => `-${o}`)],
    missingHooks: coreEnvHooks.filter(hook => !newBundle.includes(hook)),
    skillChanged,
    upstreamAdded,
    upstreamRemoved,
    merges,
  };
}

function candidateList(target: string, versions: string[]): string[] {
  const [major, minor] = target.split('.');
  return versions.filter(v => v.startsWith(`${major}.${minor}.`) && /^\d+\.\d+\.\d+$/.test(v));
}

function apply(a: RollAnalysis, pkg: any): void {
  // 1. our layer: merged files (only the ones upstream touched).
  for (const merge of a.merges) {
    if (merge.status === 'clean' || merge.status === 'upstream-only')
      writeRepoFile(merge.file.ours, merge.merged);
  }
  // 2. the pristine layer moves to the new tag: vendor/ is exactly upstream at that tag.
  for (const file of forkedFiles) {
    const pristine = theirsText.get(file.name);
    if (pristine !== undefined)
      writeRepoFile(file.vendor, pristine);
  }
  // 3. pins, install, generated help, snapshot.
  pkg.dependencies['patchright-core'] = a.target;
  if (pkg.devDependencies?.patchright)
    pkg.devDependencies.patchright = a.target;
  fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('\nInstalling...');
  npm('install --no-audit --no-fund');
  npm('exec -- tsx scripts/sync-help.ts');
  for (const file of watchedFiles) {
    const source = path.join(root, 'node_modules', 'patchright-core', file);
    const destination = path.join(snapshotDir, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(source))
      fs.copyFileSync(source, destination);
    else
      fs.rmSync(destination, { force: true });
  }
  fs.writeFileSync(path.join(snapshotDir, 'snapshot.json'), JSON.stringify({ name: 'patchright-core', version: a.target, files: watchedFiles.length }, null, 2) + '\n');
  // 4. bookkeeping.
  const versions = readVersions();
  versions.patchrightCore = {
    version: a.target,
    playwrightVersion: a.playwright!.version,
    playwrightTag: a.playwright!.tag,
    rolledAt: new Date().toISOString().slice(0, 10),
    vendorSha256: vendorHashes(forkedFiles),
  };
  writeVersions(versions);
  regenerateClientPatch();
}

// Pristine texts at the target tag, kept for apply() (vendor refresh of clean merges).
const theirsText = new Map<string, string>();

async function main(): Promise<void> {
  if (flags.has('--check'))
    return check();
  if (flags.has('--verify'))
    return verify();

  const pkg = readPackageJson();
  const current: string = pkg.dependencies['patchright-core'];
  const requested = positional[0] ?? 'latest';
  const target = requested === 'latest' ? npmLatest('patchright-core') : requested.replace(/^v/, '');
  if (!npmVersions('patchright-core').includes(target))
    throw new Error(`patchright-core@${target} is not on npm`);
  if (target === current) {
    console.log(`patchright-core is already at ${current}.`);
    return;
  }
  console.log(`Rolling patchright-core ${current} -> ${target}${dryRun ? ' (dry run)' : ''}\n`);

  const analysis = await analyze(current, target);
  // apply() needs the pristine texts for the vendor refresh; collect them from the merges.
  if (analysis.playwright) {
    for (const file of forkedFiles) {
      const text = await fetchTextOrUndefined(githubRawUrl(playwrightRepo, analysis.playwright.tag, file.upstream));
      if (text !== undefined)
        theirsText.set(file.name, text);
    }
  }
  const verdict = classifyRoll(analysis);
  // A conflict where we deliberately keep our side (the product rename, our own install path,
  // the daemon environment) never merges cleanly on a rerun: the base only moves once the roll
  // lands. `--resolved` says the hunks were ported into src/ by hand, so the conflicted files
  // are left exactly as they are and the rest of the roll proceeds. Other blockers -- no merge
  // base, a missing PWTEST_* hook -- still stop everything.
  const conflicts = analysis.merges.filter(merge => merge.status === 'conflict').length;
  const onlyConflicts = conflicts > 0 && verdict.reasons.length === conflicts;
  const blocked = verdict.classification === 'blocked' && !(resolved && onlyConflicts);
  const willApply = !dryRun && !blocked;
  const report = renderRollReport(analysis, verdict, { dryRun, applied: willApply });
  writeRollArtifact('report.md', report);
  writeRollArtifact('result.json', JSON.stringify({ ...verdict, current, target, playwright: analysis.playwright?.tag, dryRun, applied: willApply, resolvedByHand: resolved && onlyConflicts, merges: analysis.merges.map(m => ({ file: m.file.ours, status: m.status, conflicts: m.conflicts })) }, null, 2) + '\n');
  for (const merge of analysis.merges) {
    if (merge.status === 'conflict')
      writeRollArtifact(path.join('conflicts', path.basename(merge.file.ours) + '.merged'), merge.merged);
  }
  console.log(json ? JSON.stringify({ classification: verdict.classification, reasons: verdict.reasons }) : report);

  if (dryRun) {
    console.log(`\nDry run: nothing changed. Report in .roll/report.md${blocked ? ', conflicted merges in .roll/conflicts/' : ''}.`);
    return;
  }
  if (blocked) {
    console.error('\nBlocked: nothing was written. Resolve the conflicts from .roll/conflicts/ by hand (src/ is ours, vendor/ is the base), then rerun with --resolved.');
    process.exit(2);
  }
  if (resolved && onlyConflicts)
    console.log(`\nTaking src/ as hand-resolved for: ${analysis.merges.filter(m => m.status === 'conflict').map(m => m.file.ours).join(', ')}.`);
  apply(analysis, pkg);
  console.log(`\nApplied. Next: npm run check && npm test, node bin/patchright-cli.js selftest, an Upstream line in CHANGELOG.md, commit "chore: roll patchright-core to ${target}".`);
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});

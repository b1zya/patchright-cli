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

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { test, expect } from 'patchright/test';

import {
  candidatePlaywrightVersions, classifyRoll, forkedFiles, matchPlaywrightVersion, mergeThreeWay, playwrightCliFiles, readVersions,
  root, semverGreater, sha256, vendorHashes,
} from '../../scripts/upstream/lib';
import { classifyPlaywrightCli } from '../../scripts/watch-playwright-cli';

import type { FileMerge, RollAnalysis } from '../../scripts/upstream/lib';

const analysis = (overrides: Partial<RollAnalysis> = {}): RollAnalysis => ({
  current: '1.62.3', target: '1.63.0', playwright: { version: '1.63.0', tag: 'v1.63.0', tried: ['1.63.0'] }, triedPlaywright: ['1.63.0'],
  compiledChanged: [], commandsAdded: [], commandsRemoved: [], daemonOptionsDelta: [], missingHooks: [], skillChanged: false,
  upstreamAdded: [], upstreamRemoved: [], merges: [], ...overrides,
});
const merge = (ours: string, status: FileMerge['status'], conflicts = 0): FileMerge => ({ file: { name: ours, upstream: ours, vendor: `vendor/${ours}`, ours: `src/${ours}` }, status, conflicts, merged: '' });

test('patchright-core is matched to the Playwright release with the same major.minor and a patch no higher than its own', () => {
  const all = ['1.61.0', '1.62.0-beta-1', '1.62.0', '1.62.1', '1.62.5', '1.63.0', '1.63.0-alpha-2026-08-01'];
  expect(candidatePlaywrightVersions('1.62.3', all)).toEqual(['1.62.1', '1.62.0']);
  expect(candidatePlaywrightVersions('1.63.2', all)).toEqual(['1.63.0']);
  expect(candidatePlaywrightVersions('1.64.0', all)).toEqual([]);
  expect(semverGreater('1.63.0', '1.62.3')).toBe(true);
  expect(semverGreater('1.62.3', '1.62.3')).toBe(false);
  expect(semverGreater('1.62.3', '1.63.0')).toBe(false);
});

test('the compiled client identifies the tag: the first candidate whose files are byte-identical wins', () => {
  const dir = test.info().outputPath('match');
  const write = (name: string, files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name, file)), { recursive: true });
      fs.writeFileSync(path.join(dir, name, file), text);
    }
    return path.join(dir, name);
  };
  const files = ['lib/a.js', 'lib/b.js'];
  const patchright = write('patchright', { 'lib/a.js': 'A', 'lib/b.js': 'B' });
  write('1.62.1', { 'lib/a.js': 'A', 'lib/b.js': 'B-different' });
  write('1.62.0', { 'lib/a.js': 'A', 'lib/b.js': 'B' });
  const fetched: string[] = [];
  const match = matchPlaywrightVersion(patchright, '1.62.3', files, { versions: ['1.62.0', '1.62.1', '1.63.0'], fetchPackage: v => { fetched.push(v); return path.join(dir, v); } });
  expect(match).toEqual({ version: '1.62.0', tag: 'v1.62.0', tried: ['1.62.1', '1.62.0'] });
  expect(fetched).toEqual(['1.62.1', '1.62.0']);
  expect(matchPlaywrightVersion(patchright, '1.62.3', files, { versions: ['1.62.1'], fetchPackage: v => path.join(dir, v) })).toBeUndefined();
});

test('three-way merge: upstream-only changes land, our changes survive, overlaps are conflicts and never written', () => {
  const base = 'line 1\nline 2\nline 3\nline 4\nline 5\n';
  // We changed line 1; upstream changed line 5: both survive.
  const ours = base.replace('line 1', 'line 1 (ours)');
  const theirs = base.replace('line 5', 'line 5 (upstream)');
  const clean = mergeThreeWay(ours, base, theirs);
  expect(clean.status).toBe('clean');
  expect(clean.text).toBe('line 1 (ours)\nline 2\nline 3\nline 4\nline 5 (upstream)\n');
  // Upstream did not touch the file: nothing to do.
  expect(mergeThreeWay(ours, base, base)).toEqual({ status: 'unchanged', text: ours, conflicts: 0 });
  // We never modified the file: take upstream as is.
  expect(mergeThreeWay(base, base, theirs)).toEqual({ status: 'upstream-only', text: theirs, conflicts: 0 });
  // Both sides changed the same line: a conflict with markers, counted.
  const conflict = mergeThreeWay(base.replace('line 3', 'line 3 (ours)'), base, base.replace('line 3', 'line 3 (upstream)'), { ours: 'src/x.ts', base: 'vendor/x.ts', theirs: 'upstream' });
  expect(conflict.status).toBe('conflict');
  expect(conflict.conflicts).toBe(1);
  expect(conflict.text).toContain('<<<<<<< src/x.ts');
  expect(conflict.text).toContain('>>>>>>> upstream');
  // Upstream deleted the file: keep ours, flag it.
  expect(mergeThreeWay(ours, base, undefined).status).toBe('removed-upstream');
  // CRLF input never produces a mixed-ending merge.
  expect(mergeThreeWay(ours.replace(/\n/g, '\r\n'), base, theirs).text).not.toContain('\r');
});

test('roll verdicts: safe when nothing we fork changed, review when the surface moved, blocked on conflicts or missing hooks', () => {
  expect(classifyRoll(analysis()).classification).toBe('safe');
  expect(classifyRoll(analysis({ compiledChanged: ['lib/tools/cli-client/program.js'], merges: [merge('program.ts', 'clean')] })).classification).toBe('review');
  expect(classifyRoll(analysis({ commandsAdded: ['recording-start'] })).classification).toBe('review');
  expect(classifyRoll(analysis({ daemonOptionsDelta: ['+--foo'] })).classification).toBe('review');
  expect(classifyRoll(analysis({ upstreamAdded: ['newFile.ts'] })).classification).toBe('review');
  const conflicted = classifyRoll(analysis({ merges: [merge('program.ts', 'clean'), merge('session.ts', 'conflict', 2)] }));
  expect(conflicted.classification).toBe('blocked');
  expect(conflicted.reasons[0]).toContain('src/session.ts: 2 conflict(s)');
  expect(classifyRoll(analysis({ missingHooks: ['PWTEST_SOCKETS_DIR'] })).classification).toBe('blocked');
  expect(classifyRoll(analysis({ playwright: undefined, triedPlaywright: ['1.63.0'] })).classification).toBe('blocked');
});

test('playwright-cli verdicts: safe when only unused files changed, review for rewritten files, blocked on a conflict', () => {
  expect(classifyPlaywrightCli([merge('integration.spec.ts', 'unchanged')], []).classification).toBe('safe');
  expect(classifyPlaywrightCli([merge('integration.spec.ts', 'clean')], []).classification).toBe('review');
  expect(classifyPlaywrightCli([merge('integration.spec.ts', 'unchanged')], [{ file: 'README.md' }]).classification).toBe('review');
  expect(classifyPlaywrightCli([merge('integration.spec.ts', 'conflict', 1)], []).classification).toBe('blocked');
});

test('versions.json records the upstream the checkout is based on, and vendor/ is pristine (hashes match)', () => {
  const versions = readVersions();
  const pinned = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies['patchright-core'];
  expect(versions.patchrightCore.version).toBe(pinned);
  expect(versions.patchrightCore.playwrightTag).toBe(`v${versions.patchrightCore.playwrightVersion}`);
  expect(versions.playwrightCli.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(vendorHashes(forkedFiles)).toEqual(versions.patchrightCore.vendorSha256);
  expect(vendorHashes(playwrightCliFiles)).toEqual(versions.playwrightCli.vendorSha256);
  for (const file of [...forkedFiles, ...playwrightCliFiles]) {
    expect(fs.existsSync(path.join(root, file.vendor)), file.vendor).toBe(true);
    expect(fs.existsSync(path.join(root, file.ours)), file.ours).toBe(true);
  }
  expect(sha256('a\r\nb')).toBe(sha256('a\nb'));
});

test('session-check is silent on a coherent checkout and speaks only when something is off', () => {
  const dir = test.info().outputPath('checkout');
  const write = (file: string, data: any) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), typeof data === 'string' ? data : JSON.stringify(data));
  };
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts', 'session-check.mjs'), '--root', dir, '--no-network'], { encoding: 'utf8' });
  write('package.json', { dependencies: { 'patchright-core': '1.0.0' } });
  write('node_modules/patchright-core/package.json', { version: '1.0.0' });
  write('scripts/upstream-snapshot/versions.json', { patchrightCore: { version: '1.0.0' } });
  write('src/cli.ts', 'x');
  write('lib/cli.js', 'built');
  fs.utimesSync(path.join(dir, 'lib', 'cli.js'), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  expect(run().stdout).toBe('');

  write('node_modules/patchright-core/package.json', { version: '0.9.0' });
  const drift = run();
  expect(drift.status).toBe(0);
  expect(drift.stdout).toContain('0.9.0 is installed but package.json pins 1.0.0');
  expect(drift.stdout.split('\n').filter(Boolean)).toHaveLength(1);

  fs.rmSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.utimesSync(path.join(dir, 'lib', 'cli.js'), new Date(0), new Date(0));
  const stale = run().stdout;
  expect(stale).toContain('not installed');
  expect(stale).toContain('older than src/');
});

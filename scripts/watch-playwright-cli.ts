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

// Tracks microsoft/playwright-cli, the repository this fork descends from.
//
//   tsx scripts/watch-playwright-cli.ts [--apply] [--json] [--head <sha>]
//
// Compares the commit recorded in scripts/upstream-snapshot/versions.json with the current
// upstream HEAD (GitHub compare API). The one file we still carry a modified copy of
// (tests/integration.spec.ts -> tests/integration/core.spec.ts) is three-way merged through
// its vendored pristine copy; files we rewrote (README, dev skill, shim, workflows) are
// reported with their upstream patch for a human to read. Verdicts: `safe` (only files we
// do not use changed), `review` (a mapped file merged cleanly or a report-only file
// changed), `blocked` (merge conflict). Without --apply nothing is written; with it, the
// merged file, the vendored copy and versions.json are updated unless blocked.

import path from 'path';

import {
  classifyRoll, fetchTextOrUndefined, githubCompare, githubRawUrl, gitLsRemoteHead, mergeForkedFiles, playwrightCliFiles,
  playwrightCliReportOnly, playwrightCliRepo, playwrightCliUrl, readRepoFile, readVersions, vendorHashes, writeRepoFile,
  writeRollArtifact, writeVersions,
} from './upstream/lib';

import type { Classification, CompareResult, FileMerge } from './upstream/lib';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const json = argv.includes('--json');
const headOverride = argv.includes('--head') ? argv[argv.indexOf('--head') + 1] : undefined;

export type PlaywrightCliResult = {
  changed: boolean;
  base: string;
  head: string;
  commits: { sha: string, message: string, date: string }[];
  classification: Classification;
  reasons: string[];
  merges: { file: string, status: string, conflicts: number }[];
  reportOnly: { file: string, status: string, patch: string }[];
  other: string[];
  applied: boolean;
};

export function classifyPlaywrightCli(merges: FileMerge[], reportOnly: { file: string }[]): { classification: Classification, reasons: string[] } {
  // Reuse the roll classifier's shape: only merges and a "surface changed" signal matter here.
  const verdict = classifyRoll({
    current: '', target: '', triedPlaywright: [], playwright: { version: '', tag: '', tried: [] },
    compiledChanged: [], commandsAdded: [], commandsRemoved: [], daemonOptionsDelta: [], missingHooks: [],
    skillChanged: false, upstreamAdded: [], upstreamRemoved: [], merges,
  });
  if (verdict.classification === 'blocked')
    return verdict;
  const reasons = verdict.classification === 'review' ? verdict.reasons : [];
  if (reportOnly.length)
    reasons.push(`upstream changed files we rewrote (read the patches): ${reportOnly.map(f => f.file).join(', ')}`);
  return reasons.length ? { classification: 'review', reasons } : { classification: 'safe', reasons: ['upstream changed nothing this fork uses'] };
}

export function renderPlaywrightCliReport(r: PlaywrightCliResult): string {
  const lines = [`# microsoft/playwright-cli ${r.base.slice(0, 7)} -> ${r.head.slice(0, 7)}`, '', `Verdict: **${r.classification}**${r.applied ? ' (applied)' : ''}`, ''];
  for (const reason of r.reasons)
    lines.push(`- ${reason}`);
  lines.push('', '## Commits', '');
  for (const commit of r.commits)
    lines.push(`- ${commit.sha.slice(0, 7)} ${commit.message.split('\n')[0]} (${commit.date.slice(0, 10)})`);
  lines.push('', '## Mapped files (three-way merge)', '', '| file | result |', '|---|---|');
  for (const merge of r.merges)
    lines.push(`| ${merge.file} | ${merge.status}${merge.conflicts ? ` (${merge.conflicts})` : ''} |`);
  if (r.reportOnly.length) {
    lines.push('', '## Files we rewrote (upstream patch, for reading)', '');
    for (const entry of r.reportOnly)
      lines.push(`### ${entry.file} (${entry.status})`, '', '```diff', entry.patch.split('\n').slice(0, 80).join('\n'), '```', '');
  }
  if (r.other.length)
    lines.push('', '## Other upstream files', '', ...r.other.map(f => `- ${f}`));
  return lines.join('\n') + '\n';
}

async function main(): Promise<void> {
  const versions = readVersions();
  const base = versions.playwrightCli.commit;
  const head = headOverride ?? gitLsRemoteHead(playwrightCliUrl);
  if (head === base) {
    const result: PlaywrightCliResult = { changed: false, base, head, commits: [], classification: 'safe', reasons: ['up to date'], merges: [], reportOnly: [], other: [], applied: false };
    writeRollArtifact('playwright-cli-result.json', JSON.stringify(result, null, 2) + '\n');
    console.log(json ? JSON.stringify(result) : `microsoft/playwright-cli is at ${base.slice(0, 7)}; nothing new.`);
    return;
  }

  const compare: CompareResult = await githubCompare(playwrightCliRepo, base, head);
  const files = compare.files ?? [];
  const theirs = new Map<string, string | undefined>();
  for (const file of playwrightCliFiles)
    theirs.set(file.name, await fetchTextOrUndefined(githubRawUrl(playwrightCliRepo, head, file.upstream)));
  const merges = mergeForkedFiles(playwrightCliFiles, {
    ours: file => readRepoFile(file.ours) ?? '',
    base: file => readRepoFile(file.vendor) ?? '',
    theirs: file => theirs.get(file.name),
  });
  const reportOnly = files.filter(f => playwrightCliReportOnly.includes(f.filename)).map(f => ({ file: f.filename, status: f.status, patch: f.patch ?? '(binary or too large; see upstream)' }));
  const mapped = new Set(playwrightCliFiles.map(f => f.upstream));
  const other = files.filter(f => !mapped.has(f.filename) && !playwrightCliReportOnly.includes(f.filename)).map(f => `${f.filename} (${f.status})`);
  const verdict = classifyPlaywrightCli(merges, reportOnly);
  const willApply = apply && verdict.classification !== 'blocked';

  const result: PlaywrightCliResult = {
    changed: true, base, head,
    commits: compare.commits.map(c => ({ sha: c.sha, message: c.commit.message, date: c.commit.committer.date })),
    ...verdict,
    merges: merges.map(m => ({ file: m.file.ours, status: m.status, conflicts: m.conflicts })),
    reportOnly, other, applied: willApply,
  };
  const report = renderPlaywrightCliReport(result);
  writeRollArtifact('playwright-cli-report.md', report);
  writeRollArtifact('playwright-cli-result.json', JSON.stringify(result, null, 2) + '\n');
  for (const merge of merges) {
    if (merge.status === 'conflict')
      writeRollArtifact(path.join('conflicts', path.basename(merge.file.ours) + '.merged'), merge.merged);
  }
  console.log(json ? JSON.stringify({ changed: true, classification: verdict.classification, reasons: verdict.reasons, head }) : report);

  if (verdict.classification === 'blocked') {
    console.error('Blocked: nothing was written; conflicted merges are in .roll/conflicts/.');
    process.exit(2);
  }
  if (!willApply)
    return;
  for (const merge of merges) {
    if (merge.status === 'clean' || merge.status === 'upstream-only')
      writeRepoFile(merge.file.ours, merge.merged);
    const pristine = theirs.get(merge.file.name);
    if (pristine !== undefined)
      writeRepoFile(merge.file.vendor, pristine);
  }
  versions.playwrightCli = {
    repository: playwrightCliRepo,
    commit: head,
    date: compare.commits.at(-1)?.commit.committer.date,
    trackedAt: new Date().toISOString().slice(0, 10),
    vendorSha256: vendorHashes(playwrightCliFiles),
  };
  writeVersions(versions);
  console.log(`Applied: tracking ${head.slice(0, 7)}.`);
}

if (require.main === module) {
  main().catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}

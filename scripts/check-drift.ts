// Fails when the installed patchright-core no longer matches what our client was forked
// from and verified against. Run by `npm run check` and CI.
//
//   - scripts/upstream-snapshot/** must equal the same files in node_modules/patchright-core
//     (the pin was bumped without running `npm run roll`, or the snapshot is stale);
//   - src/help/help.generated.json must be generated from the installed version;
//   - the PWTEST_* environment hooks we rely on must still exist in coreBundle.js.

import fs from 'fs';
import path from 'path';

import { corePackageJSON, coreRoot } from '../src/core';
import { coreEnvHooks } from '../src/daemonEnv';
import { forkedFiles, readVersions, vendorHashes } from './upstream/lib';

export const snapshotDir = path.join(__dirname, 'upstream-snapshot');

export const watchedFiles = [
  'lib/tools/cli-client/program.js',
  'lib/tools/cli-client/session.js',
  'lib/tools/cli-client/registry.js',
  'lib/tools/cli-client/output.js',
  'lib/tools/cli-client/channelSessions.js',
  'lib/tools/cli-client/cli.js',
  'lib/tools/cli-client/minimist.js',
  'lib/tools/cli-client/help.json',
  'lib/entry/cliDaemon.js',
  'lib/tools/utils/socketConnection.js',
  'lib/tools/skills/playwright-cli/SKILL.md',
];

function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function checkDrift(): { problems: string[] } {
  const problems: string[] = [];

  const snapshotMeta = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'snapshot.json'), 'utf8'));
  if (snapshotMeta.version !== corePackageJSON.version)
    problems.push(`upstream-snapshot is from ${snapshotMeta.name}@${snapshotMeta.version}, installed is ${corePackageJSON.name}@${corePackageJSON.version}; run \`npm run roll\``);

  for (const file of watchedFiles) {
    const snapshot = path.join(snapshotDir, file);
    const installed = path.join(coreRoot, file);
    if (!fs.existsSync(installed)) {
      problems.push(`${file} no longer exists in patchright-core; the client relies on it`);
      continue;
    }
    if (!fs.existsSync(snapshot)) {
      problems.push(`${file} missing from upstream-snapshot; run \`npm run roll\``);
      continue;
    }
    if (normalize(fs.readFileSync(snapshot, 'utf8')) !== normalize(fs.readFileSync(installed, 'utf8')))
      problems.push(`${file} differs from upstream-snapshot: port the change into src/ and refresh the snapshot with \`npm run roll\``);
  }

  const generated = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'help', 'help.generated.json'), 'utf8'));
  const expectedFrom = `${corePackageJSON.name}@${corePackageJSON.version}`;
  if (generated._generatedFrom !== expectedFrom)
    problems.push(`help.generated.json was generated from ${generated._generatedFrom}, installed is ${expectedFrom}; run \`npm run sync-help\``);

  const coreBundle = fs.readFileSync(path.join(coreRoot, 'lib', 'coreBundle.js'), 'utf8');
  for (const hook of coreEnvHooks) {
    if (!coreBundle.includes(hook))
      problems.push(`environment hook ${hook} is gone from coreBundle.js; state isolation depends on it`);
  }

  // The pristine upstream layer (vendor/) and the bookkeeping must agree with the pin: a
  // roll that stopped halfway, or a vendored file edited by hand, would make the next
  // three-way merge silently wrong.
  const versions = readVersions();
  if (versions.patchrightCore.version !== corePackageJSON.version)
    problems.push(`scripts/upstream-snapshot/versions.json records patchright-core ${versions.patchrightCore.version}, installed is ${corePackageJSON.version}; run \`npm run roll\``);
  const hashes = vendorHashes(forkedFiles);
  for (const file of forkedFiles) {
    if (!hashes[file.vendor])
      problems.push(`${file.vendor} is missing; vendor/ holds the pristine upstream copy of every forked file`);
    else if (hashes[file.vendor] !== versions.patchrightCore.vendorSha256[file.vendor])
      problems.push(`${file.vendor} differs from the hash recorded in versions.json; vendor/ must stay pristine (run \`npm run upstream:verify\`)`);
  }

  return { problems };
}

if (require.main === module) {
  const { problems } = checkDrift();
  if (problems.length) {
    console.error('Upstream drift detected:');
    for (const problem of problems)
      console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`No drift: ${corePackageJSON.name}@${corePackageJSON.version} matches the snapshot and the generated help.`);
}

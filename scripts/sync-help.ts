// Regenerates src/help/help.generated.json from patchright-core's help.json + our overlay.
// Usage: tsx scripts/sync-help.ts [--check]   (--check exits 1 when the committed file is stale)

import fs from 'fs';
import path from 'path';

import { coreHelpJsonPath, corePackageJSON } from '../src/core';
import { applyOverlay } from '../src/help/overlay';

import type { HelpJson } from '../src/help/overlay';

const target = path.join(__dirname, '..', 'src', 'help', 'help.generated.json');
const check = process.argv.includes('--check');

const core: HelpJson = JSON.parse(fs.readFileSync(coreHelpJsonPath, 'utf8'));
const generatedFrom = `${corePackageJSON.name}@${corePackageJSON.version}`;
const next = JSON.stringify(applyOverlay(core, generatedFrom), null, 2) + '\n';

const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : undefined;
if (current === next) {
  console.log(`help.generated.json is up to date (${generatedFrom})`);
  process.exit(0);
}
if (check) {
  console.error(`help.generated.json is stale for ${generatedFrom}; run \`npm run sync-help\``);
  process.exit(1);
}
fs.writeFileSync(target, next);
console.log(`help.generated.json regenerated from ${generatedFrom}`);

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

import fs from 'fs';
import path from 'path';
import { test, expect } from 'patchright/test';

// On Windows a console-subsystem child (node.exe, chcp, wmic) started without
// `windowsHide: true` gets its own console window, which flashes on screen for the life of
// the process. Every child we start is either the daemon, ourselves (batch, selftest) or a
// short probe, so each spawn site must pass the flag. The browser itself is started by
// patchright-core (a GUI-subsystem executable, no console window); see references/platforms.md.
const srcDir = path.join(__dirname, '..', '..', 'src');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

test('every child process the client starts is created without a console window on Windows', () => {
  const offenders: string[] = [];
  const spawnCall = /(^|[^.\w])(spawn|spawnSync|execSync|execFileSync|execFile)\(/;
  for (const file of walk(srcDir)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!spawnCall.test(line) || /^\s*(\/\/|\*|import\b)/.test(line))
        return;
      const call = lines.slice(index, index + 10).join('\n');
      if (!/windowsHide:\s*true/.test(call))
        offenders.push(`${path.relative(srcDir, file)}:${index + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});

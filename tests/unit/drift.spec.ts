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

import { checkDrift, snapshotDir, watchedFiles } from '../../scripts/check-drift';
import { corePackageJSON } from '../../src/core';

test('the installed patchright-core matches the upstream snapshot and the generated help', () => {
  expect(checkDrift().problems).toEqual([]);
});

test('the snapshot covers every watched file and records the version', () => {
  for (const file of watchedFiles)
    expect(fs.existsSync(path.join(snapshotDir, file)), file).toBe(true);
  expect(JSON.parse(fs.readFileSync(path.join(snapshotDir, 'snapshot.json'), 'utf8'))).toEqual(expect.objectContaining({ name: 'patchright-core', version: corePackageJSON.version }));
});

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

import { test, expect } from 'patchright/test';

import { matchDaemonProcess } from '../../src/killAll';

test('matches our daemon and dashboard processes', () => {
  expect(matchDaemonProcess('node D:\\proj\\node_modules\\patchright-core\\lib\\entry\\cliDaemon.js default --config=x')).toBe(true);
  expect(matchDaemonProcess('/usr/bin/node /home/u/.npm/_npx/abc/node_modules/patchright-core/lib/entry/dashboardApp.js --workspaceDir=')).toBe(true);
  expect(matchDaemonProcess('node /p/.pnpm/patchright-core@1.62.3/node_modules/patchright-core/lib/entry/cliDaemon.js s')).toBe(true);
});

test('leaves a playwright-cli daemon alone', () => {
  expect(matchDaemonProcess('node C:\\Users\\u\\AppData\\Roaming\\npm\\node_modules\\@playwright\\cli\\node_modules\\playwright-core\\lib\\entry\\cliDaemon.js default')).toBe(false);
  expect(matchDaemonProcess('node /usr/lib/node_modules/playwright-core/lib/entry/dashboardApp.js')).toBe(false);
});

test('ignores unrelated processes that mention patchright-core', () => {
  expect(matchDaemonProcess('node node_modules/patchright-core/cli.js install chromium')).toBe(false);
  expect(matchDaemonProcess('chrome.exe --user-data-dir=C:\\cache\\patchright-cli\\daemon\\abc\\ud-default-chrome')).toBe(false);
});

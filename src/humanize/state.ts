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

// Per-session client state: whether the session was opened with --humanize and where the
// pointer was left, so consecutive humanized actions start from where the last one ended.
// The daemon has no pointer memory of its own. Reset on every `open`.

import fs from 'fs';
import path from 'path';

import type { Point } from './lib';

export type SessionState = {
  humanize?: boolean;
  cursor?: Point;
  humanizeWarned?: boolean;
  // Launched with --headless: no window on screen, so wait-for-user refuses to hand over.
  headless?: boolean;
  // Session lifetime (src/lifetime.ts): the watchdog process and what it enforces.
  watchdogPid?: number;
  lifetime?: { idleMs: number, ownerPid?: number };
};

export function stateFile(daemonProfilesDir: string, sessionName: string): string {
  return path.join(daemonProfilesDir, `${sessionName}.state.json`);
}

export function readState(daemonProfilesDir: string, sessionName: string): SessionState {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(daemonProfilesDir, sessionName), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeState(daemonProfilesDir: string, sessionName: string, state: SessionState): void {
  fs.mkdirSync(daemonProfilesDir, { recursive: true });
  fs.writeFileSync(stateFile(daemonProfilesDir, sessionName), JSON.stringify(state));
}

export function updateState(daemonProfilesDir: string, sessionName: string, patch: SessionState): SessionState {
  const next = { ...readState(daemonProfilesDir, sessionName), ...patch };
  writeState(daemonProfilesDir, sessionName, next);
  return next;
}

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

// Stand-in for playwright-core's `processExit` (src/bootstrap.ts), which the forked client
// calls instead of process.exit since v1.64. The upstream one only flushes a CPU profile
// first; requiring patchright-core/lib/bootstrap would also run its startup side effects,
// so the client keeps the call sites as upstream wrote them and exits directly.

export function processExit(code: number): never {
  // eslint-disable-next-line no-restricted-properties
  return process.exit(code);
}

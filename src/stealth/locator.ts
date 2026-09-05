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

// Targets given to commands are either snapshot refs (e5, f2e10) or selectors; the daemon
// resolves refs with its `aria-ref=` selector engine, which run-code snippets can use too.

const refPattern = /^(f\d+)?e\d+$/;

export function isSnapshotRef(target: string): boolean {
  return refPattern.test(target);
}

export function locatorExpression(target: string): string {
  return `page.locator(${JSON.stringify(isSnapshotRef(target) ? `aria-ref=${target}` : target)})`;
}

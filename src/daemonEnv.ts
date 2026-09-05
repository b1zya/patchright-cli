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

// The daemon and the dashboard compute their own state directories. patchright-core
// exposes these environment hooks (present and identical in 1.62.x and 1.63.x) that
// redirect every one of them; we set them on each core process we spawn and in-process
// before requiring core modules that read them.

import { daemonRoot, noGlobalConfigDir, profilesDir, serverRegistryDir, socketsDir } from './paths';

export const coreEnvHooks = [
  'PWTEST_DAEMON_SESSION_DIR',
  'PWTEST_SOCKETS_DIR',
  'PWTEST_SERVER_REGISTRY',
  'PWTEST_CLI_GLOBAL_CONFIG',
  'PWMCP_PROFILES_DIR_FOR_TEST',
] as const;

export type CoreEnvHook = typeof coreEnvHooks[number];

export function coreEnvOverrides(): Record<CoreEnvHook, string> {
  return {
    PWTEST_DAEMON_SESSION_DIR: daemonRoot(),
    PWTEST_SOCKETS_DIR: socketsDir(),
    PWTEST_SERVER_REGISTRY: serverRegistryDir(),
    PWTEST_CLI_GLOBAL_CONFIG: noGlobalConfigDir(),
    PWMCP_PROFILES_DIR_FOR_TEST: profilesDir(),
  };
}

export function coreProcessEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...process.env, ...coreEnvOverrides(), ...extra };
}

export function applyCoreEnvInProcess(): void {
  Object.assign(process.env, coreEnvOverrides());
}

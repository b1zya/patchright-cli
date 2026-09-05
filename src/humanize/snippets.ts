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

// Builds the `run-code` snippets that replace the daemon's instant input tools when
// humanize is on. Each snippet embeds the trajectory library, moves the pointer along a
// path from the last known position, performs the action with a human-ish cadence and
// returns the new pointer position for the client to remember.

import { humanizeLibSource } from './lib';

import type { Point } from './lib';

export type SnippetOptions = {
  seed: number;
  from?: Point;
};

export type ClickOptions = {
  button?: string;
  modifiers?: string[];
  double?: boolean;
};

const prologue = (options: SnippetOptions): string[] => [
  'async page => {',
  `  const H = (${humanizeLibSource})();`,
  `  const rng = H.rng(${options.seed});`,
  '  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));',
  `  let cursor = ${options.from ? JSON.stringify(options.from) : 'H.randomStart(vp, rng)'};`,
  '  const moveTo = async (to, opts) => {',
  '    for (const p of H.trajectory(cursor, to, rng, opts).slice(1)) {',
  '      await page.mouse.move(p.x, p.y);',
  '      await page.waitForTimeout(H.stepDelayMs(rng));',
  '    }',
  '    cursor = to;',
  '  };',
  '  const boxOf = async locator => {',
  '    await locator.scrollIntoViewIfNeeded();',
  '    const box = await locator.boundingBox();',
  `    if (!box) throw new Error('target is not visible');`,
  '    return box;',
  '  };',
  '  const typeText = async text => {',
  '    for (const ch of text) {',
  '      await page.keyboard.type(ch);',
  '      await page.waitForTimeout(H.typingDelayMs(ch, rng));',
  '    }',
  '  };',
];

const epilogue = ['  return { cursor };', '}'];

const modifierLines = (modifiers: string[] | undefined, direction: 'down' | 'up'): string[] =>
  (modifiers ?? []).map(modifier => `  await page.keyboard.${direction}(${JSON.stringify(modifier)});`);

function clickLines(button: string | undefined, double: boolean): string[] {
  const buttonArg = button ? `{ button: ${JSON.stringify(button)} }` : '{}';
  const lines = [
    `  await page.mouse.down(${buttonArg});`,
    '  await page.waitForTimeout(H.holdMs(rng));',
    `  await page.mouse.up(${buttonArg});`,
  ];
  if (double) {
    const secondArg = button ? `{ button: ${JSON.stringify(button)}, clickCount: 2 }` : '{ clickCount: 2 }';
    lines.push(
        '  await page.waitForTimeout(H.betweenClicksMs(rng));',
        `  await page.mouse.down(${secondArg});`,
        '  await page.waitForTimeout(H.holdMs(rng));',
        `  await page.mouse.up(${secondArg});`,
    );
  }
  return lines;
}

export function clickSnippet(locator: string, options: SnippetOptions & ClickOptions): string {
  return [
    ...prologue(options),
    `  const box = await boxOf(${locator});`,
    '  await moveTo(H.targetPoint(box, rng));',
    ...modifierLines(options.modifiers, 'down'),
    ...clickLines(options.button, !!options.double),
    ...modifierLines([...(options.modifiers ?? [])].reverse(), 'up'),
    ...epilogue,
  ].join('\n');
}

export function hoverSnippet(locator: string, options: SnippetOptions): string {
  return [
    ...prologue(options),
    `  const box = await boxOf(${locator});`,
    '  await moveTo(H.targetPoint(box, rng));',
    ...epilogue,
  ].join('\n');
}

export function dragSnippet(source: string, target: string, options: SnippetOptions): string {
  return [
    ...prologue(options),
    `  const sourceBox = await boxOf(${source});`,
    '  await moveTo(H.targetPoint(sourceBox, rng));',
    '  await page.mouse.down();',
    '  await page.waitForTimeout(H.holdMs(rng));',
    `  const targetBox = await boxOf(${target});`,
    '  await moveTo(H.targetPoint(targetBox, rng), { maxTime: 300 });',
    '  await page.waitForTimeout(H.holdMs(rng));',
    '  await page.mouse.up();',
    ...epilogue,
  ].join('\n');
}

export function moveSnippet(x: number, y: number, options: SnippetOptions): string {
  return [
    ...prologue(options),
    `  await moveTo({ x: ${x}, y: ${y} });`,
    ...epilogue,
  ].join('\n');
}

export function wheelSnippet(dx: number, dy: number, options: SnippetOptions): string {
  return [
    ...prologue(options),
    '  await page.mouse.move(cursor.x, cursor.y);',
    `  const xs = H.wheelSteps(${dx}, rng);`,
    `  const ys = H.wheelSteps(${dy}, rng);`,
    '  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {',
    '    await page.mouse.wheel(xs[i] ?? 0, ys[i] ?? 0);',
    '    await page.waitForTimeout(H.wheelDelayMs(rng));',
    '  }',
    ...epilogue,
  ].join('\n');
}

export function typeSnippet(text: string, options: SnippetOptions & { submit?: boolean }): string {
  return [
    ...prologue(options),
    `  await typeText(${JSON.stringify(text)});`,
    ...(options.submit ? [`  await page.keyboard.press('Enter');`] : []),
    ...epilogue,
  ].join('\n');
}

export function fillSnippet(locator: string, text: string, options: SnippetOptions & { submit?: boolean }): string {
  return [
    ...prologue(options),
    `  const box = await boxOf(${locator});`,
    '  await moveTo(H.targetPoint(box, rng));',
    ...clickLines(undefined, false),
    `  await page.keyboard.press('ControlOrMeta+a');`,
    '  await page.waitForTimeout(H.holdMs(rng));',
    `  await page.keyboard.press('Backspace');`,
    '  await page.waitForTimeout(H.holdMs(rng));',
    `  await typeText(${JSON.stringify(text)});`,
    ...(options.submit ? [`  await page.keyboard.press('Enter');`] : []),
    ...epilogue,
  ].join('\n');
}

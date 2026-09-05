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

import vm from 'vm';
import { test, expect } from 'patchright/test';

import { buildSnippet } from '../../src/humanize';
import { humanizeLib, humanizeLibSource } from '../../src/humanize/lib';
import { readState, updateState, writeState } from '../../src/humanize/state';

const H = humanizeLib();

test('trajectory starts at the origin, ends exactly on the target and stays near the move box', () => {
  const from = { x: 100, y: 100 };
  const to = { x: 700, y: 400 };
  for (const seed of [1, 2, 3, 42, 1234]) {
    const path = H.trajectory(from, to, H.rng(seed));
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(path.length).toBeLessThanOrEqual(150);
    for (const p of path) {
      expect(p.x).toBeGreaterThanOrEqual(100 - 80 - 3);
      expect(p.x).toBeLessThanOrEqual(700 + 80 + 3);
      expect(p.y).toBeGreaterThanOrEqual(100 - 80 - 3);
      expect(p.y).toBeLessThanOrEqual(400 + 80 + 3);
    }
  }
});

test('trajectory is deterministic under a seed and varies across seeds', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 300, y: 200 };
  expect(H.trajectory(from, to, H.rng(7))).toEqual(H.trajectory(from, to, H.rng(7)));
  expect(H.trajectory(from, to, H.rng(7))).not.toEqual(H.trajectory(from, to, H.rng(8)));
});

test('sample count follows the length-based clamp and eases out', () => {
  const r = H.rng(5);
  const short = H.trajectory({ x: 0, y: 0 }, { x: 3, y: 0 }, r);
  expect(short.length).toBeGreaterThanOrEqual(2);
  const long = H.trajectory({ x: 0, y: 0 }, { x: 2000, y: 1000 }, r, { maxTime: 120 });
  expect(long.length).toBe(120);
  // Ease-out: the second half of the samples covers less distance than the first half.
  const dist = (a: { x: number, y: number }, b: { x: number, y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const half = Math.floor(long.length / 2);
  const firstHalf = dist(long[0], long[half]);
  const secondHalf = dist(long[half], long[long.length - 1]);
  expect(firstHalf).toBeGreaterThan(secondHalf);
});

test('cadence helpers stay within their bounds', () => {
  const r = H.rng(99);
  for (let i = 0; i < 200; i++) {
    expect(H.holdMs(r)).toBeGreaterThanOrEqual(40);
    expect(H.holdMs(r)).toBeLessThanOrEqual(120);
    expect(H.stepDelayMs(r)).toBeGreaterThanOrEqual(8);
    expect(H.stepDelayMs(r)).toBeLessThan(14);
    expect(H.typingDelayMs('a', r)).toBeLessThan(180);
    expect(H.typingDelayMs(' ', r)).toBeGreaterThanOrEqual(310);
  }
  const box = { x: 10, y: 20, width: 100, height: 40 };
  for (let i = 0; i < 50; i++) {
    const p = H.targetPoint(box, r);
    expect(p.x).toBeGreaterThanOrEqual(40);
    expect(p.x).toBeLessThanOrEqual(80);
    expect(p.y).toBeGreaterThanOrEqual(32);
    expect(p.y).toBeLessThanOrEqual(48);
  }
  for (const delta of [-300, 7, 120]) {
    const steps = H.wheelSteps(delta, r);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.reduce((a, b) => a + b, 0)).toBe(delta);
  }
  expect(H.wheelSteps(0, r)).toEqual([]);
});

test('the library source is self-contained and evaluates in a bare context', () => {
  const lib = vm.runInNewContext(`(${humanizeLibSource})()`, {});
  const path = lib.trajectory({ x: 0, y: 0 }, { x: 50, y: 50 }, lib.rng(3));
  expect(path[path.length - 1]).toEqual({ x: 50, y: 50 });
});

test('snippets embed the target, the seed and the previous cursor', () => {
  const click = buildSnippet('click', { _: ['click', 'e5', 'right'], modifiers: 'Shift' }, { seed: 11, from: { x: 1, y: 2 } })!;
  expect(click).toContain('page.locator("aria-ref=e5")');
  expect(click).toContain('H.rng(11)');
  expect(click).toContain('let cursor = {"x":1,"y":2};');
  expect(click).toContain('page.mouse.down({ button: "right" })');
  expect(click).toContain('page.keyboard.down("Shift")');
  expect(click).toContain('return { cursor };');

  const dbl = buildSnippet('dblclick', { _: ['dblclick', '#btn'] }, { seed: 1 })!;
  expect(dbl).toContain('clickCount: 2');
  expect(dbl).toContain('let cursor = H.randomStart(vp, rng);');

  const fill = buildSnippet('fill', { _: ['fill', 'e1', 'hello world'], submit: true }, { seed: 1 })!;
  expect(fill).toContain('await typeText("hello world");');
  expect(fill).toContain(`page.keyboard.press('ControlOrMeta+a')`);
  expect(fill).toContain(`page.keyboard.press('Enter')`);

  expect(buildSnippet('type', { _: ['type', 'abc'] }, { seed: 1 })).toContain('await typeText("abc");');
  expect(buildSnippet('mousemove', { _: ['mousemove', '10', '20'] }, { seed: 1 })).toContain('await moveTo({ x: 10, y: 20 });');
  expect(buildSnippet('mousewheel', { _: ['mousewheel', '0', '300'] }, { seed: 1 })).toContain('H.wheelSteps(300, rng)');
  expect(buildSnippet('drag', { _: ['drag', 'e1', 'e2'] }, { seed: 1 })).toContain('maxTime: 300');
  expect(buildSnippet('click', { _: ['click'] }, { seed: 1 })).toBeUndefined();
  expect(buildSnippet('snapshot', { _: ['snapshot'] }, { seed: 1 })).toBeUndefined();
});

test('session state round-trips and merges', () => {
  const dir = test.info().outputPath('daemon');
  expect(readState(dir, 'default')).toEqual({});
  writeState(dir, 'default', { humanize: true });
  expect(updateState(dir, 'default', { cursor: { x: 5, y: 6 } })).toEqual({ humanize: true, cursor: { x: 5, y: 6 } });
  expect(readState(dir, 'default')).toEqual({ humanize: true, cursor: { x: 5, y: 6 } });
});

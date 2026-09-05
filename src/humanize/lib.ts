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

// Human-like mouse trajectories and input cadence. The algorithm follows the approach of
// HumanCursor (riflosnake, MIT): a Bézier curve through random internal knots, vertical
// distortion, then time-based resampling with an ease-out so the pointer decelerates
// into the target. Written as one self-contained factory so it can be serialized with
// toString() and run inside the daemon through `run-code`; nothing here may reference
// module scope.

export type Point = { x: number, y: number };
export type Box = { x: number, y: number, width: number, height: number };
export type Rng = () => number;

export type TrajectoryOptions = {
  knots?: number;
  margin?: number;
  minTime?: number;
  maxTime?: number;
};

export function humanizeLib() {
  // mulberry32: small, seedable, good enough for cursor noise.
  const rng = (seed: number): Rng => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  const normal = (r: Rng, mean: number, std: number): number => {
    const u = 1 - r();
    const v = r();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  // Random internal control points inside the bounding box of the move, padded by `margin`.
  const knots = (from: Point, to: Point, r: Rng, count = 2, margin = 80): Point[] => {
    const minX = Math.min(from.x, to.x) - margin;
    const maxX = Math.max(from.x, to.x) + margin;
    const minY = Math.min(from.y, to.y) - margin;
    const maxY = Math.max(from.y, to.y) + margin;
    const result: Point[] = [];
    for (let i = 0; i < count; i++)
      result.push({ x: minX + r() * (maxX - minX), y: minY + r() * (maxY - minY) });
    return result;
  };

  // Bernstein-polynomial evaluation of the curve through `controls`, sampled `n` times.
  const bezier = (controls: Point[], n: number): Point[] => {
    const degree = controls.length - 1;
    const binomial: number[] = [];
    for (let k = 0; k <= degree; k++) {
      let value = 1;
      for (let i = 1; i <= k; i++)
        value = value * (degree - k + i) / i;
      binomial.push(value);
    }
    const samples = Math.max(2, Math.round(n));
    const points: Point[] = [];
    for (let s = 0; s < samples; s++) {
      const t = s / (samples - 1);
      let x = 0;
      let y = 0;
      for (let k = 0; k <= degree; k++) {
        const weight = binomial[k] * Math.pow(1 - t, degree - k) * Math.pow(t, k);
        x += controls[k].x * weight;
        y += controls[k].y * weight;
      }
      points.push({ x, y });
    }
    return points;
  };

  // Adds small vertical jitter to interior points; the endpoints stay exact.
  const distortY = (points: Point[], r: Rng, mean = 1, std = 1, frequency = 0.5): Point[] =>
    points.map((p, i) => (i === 0 || i === points.length - 1 || r() >= frequency) ? p : { x: p.x, y: p.y + Math.round(normal(r, mean, std)) });

  const pathLength = (points: Point[]): number => {
    let length = 0;
    for (let i = 1; i < points.length; i++)
      length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    return length;
  };

  // Resamples the curve into the number of events a human move of this length produces,
  // easing out so the pointer slows down near the target. The last sample is the target.
  const tween = (points: Point[], minTime = 0, maxTime = 150): Point[] => {
    const target = Math.round(clamp(Math.pow(pathLength(points), 0.25) * 20, minTime + 2, Math.max(maxTime, minTime + 2)));
    const result: Point[] = [];
    for (let i = 0; i < target; i++) {
      const t = i / (target - 1);
      const eased = -t * (t - 2);
      result.push(points[Math.round(eased * (points.length - 1))]);
    }
    result[result.length - 1] = points[points.length - 1];
    return result;
  };

  const trajectory = (from: Point, to: Point, r: Rng, options: TrajectoryOptions = {}): Point[] => {
    const samples = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 2);
    const curve = bezier([from, ...knots(from, to, r, options.knots, options.margin), to], samples);
    return tween(distortY(curve, r), options.minTime, options.maxTime);
  };

  // Somewhere in the middle 40% of the element, never dead center.
  const targetPoint = (box: Box, r: Rng): Point => ({
    x: box.x + box.width * (0.3 + 0.4 * r()),
    y: box.y + box.height * (0.3 + 0.4 * r()),
  });

  const randomStart = (viewport: { w: number, h: number }, r: Rng): Point => ({
    x: viewport.w * (0.2 + 0.6 * r()),
    y: viewport.h * (0.2 + 0.6 * r()),
  });

  const holdMs = (r: Rng): number => 40 + Math.round(r() * 80);
  const stepDelayMs = (r: Rng): number => 8 + r() * 6;
  const betweenClicksMs = (r: Rng): number => 60 + Math.round(r() * 60);
  const typingDelayMs = (char: string, r: Rng): number => 60 + r() * 120 + (/[\s.,!?;:]/.test(char) ? 250 + r() * 250 : 0);

  // Splits a wheel delta into a few uneven ticks that add up exactly.
  const wheelSteps = (delta: number, r: Rng): number[] => {
    if (!delta)
      return [];
    const count = 3 + Math.floor(r() * 6);
    const weights: number[] = [];
    for (let i = 0; i < count; i++)
      weights.push(0.5 + r());
    const total = weights.reduce((a, b) => a + b, 0);
    const steps = weights.map(w => Math.round(delta * w / total));
    steps[steps.length - 1] += delta - steps.reduce((a, b) => a + b, 0);
    return steps;
  };
  const wheelDelayMs = (r: Rng): number => 30 + r() * 50;

  return { rng, normal, knots, bezier, distortY, pathLength, tween, trajectory, targetPoint, randomStart, holdMs, stepDelayMs, betweenClicksMs, typingDelayMs, wheelSteps, wheelDelayMs };
}

export type HumanizeLib = ReturnType<typeof humanizeLib>;

export const humanizeLibSource: string = humanizeLib.toString();

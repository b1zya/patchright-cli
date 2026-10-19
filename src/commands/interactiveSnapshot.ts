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

// `snapshot --interactive`: the controls of the page and just enough structure to tell them
// apart, a fraction of the full tree on a content page. The daemon takes the snapshot as usual
// (so its refs stay valid for click/fill/...); the client prunes it. A node is kept whole when
// it can be acted on (an interactive role, or `[cursor=pointer]`); headings are kept as one
// line to orient by; landmarks and other containers are kept only when they hold something
// kept and carry a name or a landmark role; every other wrapper is dropped and its kept
// descendants move up.

import fs from 'fs';
import path from 'path';

import type { MinimistArgs } from '../args';
import type { GuardResult } from '../stealth';
import type { Output } from '../output';

const interactiveRoles = new Set([
  'button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'radio', 'scrollbar', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem',
]);
const landmarkRoles = new Set([
  'alertdialog', 'banner', 'complementary', 'contentinfo', 'dialog', 'form', 'grid', 'iframe', 'main',
  'menu', 'menubar', 'navigation', 'region', 'search', 'table', 'tablist', 'toolbar', 'tree',
]);

type Kind = 'interactive' | 'heading' | 'container';

type Pruned<T> = { node: T, kind: Kind, children: Pruned<T>[] };

function prune<T>(nodes: T[], kindOf: (node: T) => Kind, childrenOf: (node: T) => T[], keepContainer: (node: T) => boolean): Pruned<T>[] {
  const result: Pruned<T>[] = [];
  for (const node of nodes) {
    const kind = kindOf(node);
    if (kind === 'interactive') {
      result.push({ node, kind, children: [] });
      continue;
    }
    if (kind === 'heading') {
      result.push({ node, kind, children: [] });
      continue;
    }
    const children = prune(childrenOf(node), kindOf, childrenOf, keepContainer);
    if (children.length && keepContainer(node))
      result.push({ node, kind, children });
    else
      result.push(...children);
  }
  return result;
}

// --- YAML (text and --raw output) ---

type YamlNode = { line: string, depth: number, subtree: string[], children: YamlNode[] };

const nodeLine = /^(\s*)- (.*)$/;

function parseYaml(yaml: string): YamlNode[] {
  const roots: YamlNode[] = [];
  const stack: YamlNode[] = [];
  for (const line of yaml.split('\n')) {
    const match = line.match(nodeLine);
    if (!match) {
      // A continuation line (multi-line text): it belongs to the innermost open node.
      if (stack.length && line.trim())
        stack[stack.length - 1].subtree.push(line);
      continue;
    }
    const depth = match[1].length / 2;
    const node: YamlNode = { line: match[2], depth, subtree: [line], children: [] };
    while (stack.length && stack[stack.length - 1].depth >= depth)
      stack.pop();
    for (const open of stack)
      open.subtree.push(line);
    if (stack.length)
      stack[stack.length - 1].children.push(node);
    else
      roots.push(node);
    stack.push(node);
  }
  return roots;
}

function yamlRole(line: string): string {
  return line.match(/^[\w-]+/)?.[0] ?? '';
}

function yamlKind(node: YamlNode): Kind {
  const role = yamlRole(node.line);
  if (interactiveRoles.has(role) || node.line.includes('[cursor=pointer]'))
    return 'interactive';
  if (role === 'heading')
    return 'heading';
  return 'container';
}

function yamlKeepContainer(node: YamlNode): boolean {
  return landmarkRoles.has(yamlRole(node.line)) || /^[\w-]+ "/.test(node.line);
}

function renderYaml(nodes: Pruned<YamlNode>[], depth: number, out: string[]) {
  for (const { node, kind, children } of nodes) {
    const indent = '  '.repeat(depth);
    if (kind === 'interactive') {
      // The whole subtree (link targets, options, inner text), re-based to this depth.
      const shift = node.depth * 2;
      for (const line of node.subtree)
        out.push(indent + line.slice(Math.min(shift, line.length - line.trimStart().length)));
    } else if (kind === 'heading') {
      out.push(`${indent}- ${node.line.replace(/:$/, '')}`);
    } else {
      out.push(`${indent}- ${node.line.endsWith(':') ? node.line : node.line + ':'}`);
      renderYaml(children, depth + 1, out);
    }
  }
}

export function interactiveYaml(yaml: string): string {
  const out: string[] = [];
  renderYaml(prune(parseYaml(yaml), yamlKind, node => node.children, yamlKeepContainer), 0, out);
  return out.join('\n');
}

// --- JSON (--json output) ---

type JsonNode = { role?: string, name?: string, cursor?: string, children?: JsonNode[], [key: string]: unknown };

function jsonKind(node: JsonNode): Kind {
  const role = node.role ?? '';
  if (interactiveRoles.has(role) || node.cursor === 'pointer')
    return 'interactive';
  if (role === 'heading')
    return 'heading';
  return 'container';
}

function rebuildJson(nodes: Pruned<JsonNode>[]): JsonNode[] {
  return nodes.map(({ node, kind, children }) => {
    if (kind === 'interactive')
      return node;
    const { children: _children, ...rest } = node;
    return kind === 'heading' ? rest : { ...rest, children: rebuildJson(children) };
  });
}

export function interactiveJson(tree: JsonNode[]): JsonNode[] {
  return rebuildJson(prune(tree, jsonKind, node => node.children ?? [], node => landmarkRoles.has(node.role ?? '') || !!node.name));
}

// --- the command ---

// Takes the snapshot inline (raw) and prints, or writes to --filename, the pruned tree.
export function interactiveSnapshotRewrite(args: MinimistArgs, output: Output, cwd: string): GuardResult {
  const { interactive: _interactive, filename, raw: userRaw, ...rest } = args;
  const plain = !!userRaw;
  return {
    kind: 'rewrite',
    args: rest,
    raw: true,
    silent: true,
    onResult: text => {
      if (output.json) {
        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch {
          output.toolResult(text);
          return;
        }
        if (!Array.isArray(parsed?.snapshot)) {
          output.toolResult(text);
          return;
        }
        const snapshot = interactiveJson(parsed.snapshot);
        if (typeof filename === 'string' && filename) {
          fs.writeFileSync(path.resolve(cwd, filename), JSON.stringify(snapshot, null, 2) + '\n');
          output.toolResult(JSON.stringify({ snapshot: { file: filename, interactive: true } }, null, 2));
        } else {
          output.toolResult(JSON.stringify({ ...parsed, snapshot }, null, 2));
        }
        return;
      }
      const body = interactiveYaml(text);
      if (typeof filename === 'string' && filename) {
        fs.writeFileSync(path.resolve(cwd, filename), body + '\n');
        output.toolResult(`- [Snapshot (interactive)](${filename})`);
        return;
      }
      output.toolResult(plain ? body : `### Snapshot (interactive)\n\`\`\`yaml\n${body}\n\`\`\``);
    },
  };
}

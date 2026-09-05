// Static validation of the agent skill against the real CLI surface.
// Every `patchright-cli ...` line inside a fenced code block of SKILL.md and references/*.md
// is tokenized like a shell would, parsed with the CLI's own minimist configuration and
// checked against help.generated.json: the command must exist, every flag must be known for
// that command (or global / client-only), and the positional count must fit.
// Also checks universality: no agent-vendor specific wording, spec-compliant frontmatter.

import fs from 'fs';
import path from 'path';

import { minimist } from '../src/args';
import { loadHelp } from '../src/help';
import { clientOnlyFlagNames } from '../src/stealth/flags';

const skillDir = path.join(__dirname, '..', 'skills', 'patchright-cli');
const help = loadHelp();
const globalOptions = ['json', 'raw', 'session', 's', 'help', 'version'];
const booleanOptions = [...help.booleanOptions, 'all', 'help', 'json', 'raw', 'version'];

type Problem = { file: string, line: number, text: string, problem: string };
const problems: Problem[] = [];
let checked = 0;

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | undefined;
  let hasToken = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote)
        quote = undefined;
      else
        current += ch;
      continue;
    }
    if (ch === '"' || ch === '\'') {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === '#' && !hasToken && !current)
      break;
    if (/\s/.test(ch)) {
      if (hasToken || current) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken || current)
    tokens.push(current);
  return tokens;
}

function extractCommandLines(file: string): { line: number, text: string }[] {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const result: { line: number, text: string }[] = [];
  let inFence = false;
  let fenceLang = '';
  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      inFence = !inFence;
      fenceLang = fence[1];
      return;
    }
    if (!inFence || (fenceLang && !['bash', 'sh', 'shell', 'batch', 'powershell', ''].includes(fenceLang)))
      return;
    const match = line.match(/^\s*(?:[A-Z_]+=\S+\s+)?(?:\$\()?(?:>\s*)?patchright-cli\s+(.*)$/);
    if (match)
      result.push({ line: index + 1, text: match[1].trim() });
  });
  return result;
}

function validateCommandLine(file: string, line: number, text: string) {
  checked++;
  let tokens = tokenize(text.replace(/\s*\|.*$/, '').replace(/\s*>\s*\S+$/, '').replace(/\s*&\s*$/, '').replace(/\)\s*$/, ''));
  // PowerShell stop-parsing token and Windows caret escapes are shell-level, not ours.
  tokens = tokens.filter(t => t !== '--%').map(t => t.replace(/\^&/g, '&'));
  if (!tokens.length)
    return;
  const args = minimist(tokens, { boolean: booleanOptions, string: ['_'] });
  if (args.s) {
    args.session = args.s;
    delete args.s;
  }
  if (args.version || args.v || args.help || args.h)
    return;
  const name = args._[0];
  if (!name) {
    problems.push({ file, line, text, problem: 'no command' });
    return;
  }
  const command = help.commands[name];
  if (!command) {
    problems.push({ file, line, text, problem: `unknown command '${name}'` });
    return;
  }
  for (const key of Object.keys(args)) {
    if (key === '_' || globalOptions.includes(key) || clientOnlyFlagNames.includes(key))
      continue;
    if (!(key in command.flags))
      problems.push({ file, line, text, problem: `unknown flag --${key} for '${name}'` });
  }
  const positional = args._.slice(1);
  if (!command.variadicArg && positional.length > command.args.length)
    problems.push({ file, line, text, problem: `too many arguments for '${name}': expected ${command.args.length}, got ${positional.length}` });
}

const files = [path.join(skillDir, 'SKILL.md'), ...fs.readdirSync(path.join(skillDir, 'references')).map(f => path.join(skillDir, 'references', f))];
for (const file of files) {
  for (const { line, text } of extractCommandLines(file))
    validateCommandLine(path.relative(skillDir, file), line, text);
}

// Universality: frontmatter per the Agent Skills spec; no vendor-specific wording.
const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
const keys = frontmatter.split('\n').map(l => l.split(':')[0].trim()).filter(Boolean);
for (const key of keys) {
  if (!['name', 'description', 'allowed-tools', 'license', 'metadata', 'compatibility'].includes(key))
    problems.push({ file: 'SKILL.md', line: 1, text: key, problem: `non-standard frontmatter key '${key}'` });
}
const vendorWords = /\b(Claude|Anthropic|Copilot|Cursor|Codex|Gemini|ChatGPT)\b/;
// The skill is read by agents serving users of any country: English only, no other scripts.
const nonLatinScript = /[Ѐ-ӿͰ-Ͽ֐-׿؀-ۿ぀-ヿ一-鿿가-힯]/;
for (const file of files) {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (vendorWords.test(line))
      problems.push({ file: path.relative(skillDir, file), line: index + 1, text: line.trim().slice(0, 80), problem: 'vendor-specific wording' });
    if (nonLatinScript.test(line))
      problems.push({ file: path.relative(skillDir, file), line: index + 1, text: line.trim().slice(0, 80), problem: 'non-English text (the skill must be English only)' });
  });
}

console.log(`Checked ${checked} command lines in ${files.length} files.`);
if (problems.length) {
  for (const p of problems)
    console.log(`  ${p.file}:${p.line}  ${p.problem}\n      ${p.text}`);
  process.exit(1);
}
console.log('All command lines parse against the CLI; frontmatter is spec-compliant; no vendor-specific wording.');

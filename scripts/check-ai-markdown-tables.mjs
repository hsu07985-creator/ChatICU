import assert from 'node:assert/strict';
import { normalizeAiMarkdown } from '../src/lib/normalize-ai-markdown.ts';

const malformed = [
  '| 稀釋體積 | Piperacillin | Tazobactam ||---|---|---|| 50 mL | 60 mg/mL | 15 mg/mL || 75 mL | 40 mg/mL | 10 mg/mL |',
  '',
  '```text',
  '| A | B ||---|---|| 1 | 2 |',
  '```',
].join('\n');
const normalized = normalizeAiMarkdown(malformed);

assert.match(normalized, /\| Piperacillin \| Tazobactam \|\n\|---\|---\|---\|\n\| 50 mL/);
assert.match(normalized, /```text\n\| A \| B \|\|---\|---\|\| 1 \| 2 \|\n```/);
console.log('AI Markdown table normalization: OK');

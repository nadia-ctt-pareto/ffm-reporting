// Phase 8a: machine-checks the "locked tool-name contract" CLAUDE.md /
// lib/prompts.ts describe. `lib/server/mcp-tools.ts`'s `MCP_TOOL_NAMES` is
// what `registerMcpTools` actually registers on the MCP server (and that
// function itself asserts, at every registration pass, that the two agree
// -- see its own doc comment); THIS script separately diffs that array
// against `lib/prompts.ts`'s "Canonical MCP tool names" comment block, so
// the contract stays checked from BOTH directions (code <-> docs), not just
// internally self-consistent.
//
// `lib/prompts.ts` stays comment-only by design (Phase 8a's explicit scope
// -- no new exported const there) so this script PARSES that comment block
// directly via a plain regex rather than importing a symbol -- the same
// "hand-kept-in-sync, verbatim copy, deliberately not derived from a single
// source" posture CLAUDE.md already documents for `lib/seed.ts`'s
// `seedProjects()` vs. the SQL seed. If you ever change the tool surface,
// update `MCP_TOOL_NAMES` (lib/server/mcp-tools.ts), the "Read:"/"Write:"
// lines in lib/prompts.ts's header comment, and skills/weekly-reports/
// SKILL.md's tool reference, together -- this script is what catches a
// forgotten one.
//
// Run: npx tsx scripts/check-mcp-tool-contract.ts

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_TOOL_NAMES } from '../lib/server/mcp-tools';

const here = path.dirname(fileURLToPath(import.meta.url));
const promptsPath = path.join(here, '..', 'lib', 'prompts.ts');
const promptsSource = readFileSync(promptsPath, 'utf8');

const readLine = promptsSource.match(/\/\/\s*Read:\s*(.+)/);
const writeLine = promptsSource.match(/\/\/\s*Write:\s*(.+)/);

if (!readLine || !writeLine) {
  console.error(`FAIL: could not find the "Read:"/"Write:" canonical tool-name lines in ${promptsPath}.`);
  process.exit(1);
}

const documented = [...readLine[1].split(','), ...writeLine[1].split(',')].map((s) => s.trim()).filter(Boolean);
const registered: string[] = [...MCP_TOOL_NAMES];

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

let ok = true;

if (!sameSet(documented, registered)) {
  ok = false;
  console.error("FAIL: lib/prompts.ts's documented tool names and lib/server/mcp-tools.ts's MCP_TOOL_NAMES have drifted.");
  console.error('  documented (lib/prompts.ts):    ', documented.join(', '));
  console.error('  registered (mcp-tools.ts):       ', registered.join(', '));
}

if (documented.includes('delete_report') || registered.includes('delete_report')) {
  ok = false;
  console.error('FAIL: delete_report must never exist -- there is deliberately no delete tool (see SKILL.md\'s "Access model").');
}

if (ok) {
  console.log(`OK: ${registered.length} MCP tools match the canonical contract (lib/prompts.ts <-> lib/server/mcp-tools.ts), no delete_report.`);
  console.log('  ' + registered.join(', '));
} else {
  process.exit(1);
}

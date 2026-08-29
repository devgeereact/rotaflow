#!/usr/bin/env node
// =====================================================================
// scripts/plan-drift-audit.mjs
//
// Re-audits docs/FRESH/PRODUCT_TRANSFORMATION_PLAN_V2.md against the
// repository, using OpenRouter — the same provider and endpoint the app's
// own AI already uses (supabase/functions/ai-rota-assistant). There is no
// Anthropic dependency anywhere in this project.
//
// DESIGN — why this is a script and not an agent action:
//
// The previous version of this audit used an agentic GitHub Action, which
// could browse the repo on its own. A single OpenRouter chat completion
// cannot. Rather than pretend otherwise, the work is split so that the
// model only does the part a model is actually good at:
//
//   * DETERMINISTIC (this script, no model): gather the evidence — recent
//     git log, the plan doc, and every repo path the doc cites, with a
//     hard exists/missing verdict for each. A doc claiming "not built"
//     about a path that now exists is the highest-signal drift there is,
//     and detecting it needs no AI at all.
//   * MODEL: judge whether each claim still holds given that evidence,
//     and write the log summary.
//   * DETERMINISTIC (this script): apply the result. Corrections are
//     exact-string replacements that must match exactly once, or they are
//     skipped and reported. The model never writes the file directly.
//
// That ordering matters: if the model returns nonsense, the worst case is
// a skipped correction and a noisy summary, not a mangled document.
//
// Exit codes: 0 = audit completed (drift or not). 1 = audit could not be
// completed. The caller is expected to record a FAILED entry on 1 — see
// .github/workflows/plan-drift-audit.yml, which does that in shell so
// that reporting a model failure never depends on a model.
// =====================================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PLAN_DOC = process.env.PLAN_DOC || 'docs/FRESH/PRODUCT_TRANSFORMATION_PLAN_V2.md';
const MODEL = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const API_KEY = process.env.OPENROUTER_API_KEY;
const APP_URL = process.env.APP_URL || 'https://rotaflow.space';

/** Fail in a way the workflow can turn into a FAILED log entry. */
function bail(reason) {
  console.error(`AUDIT_FAILED: ${reason}`);
  process.exit(1);
}

if (!API_KEY) {
  bail('OPENROUTER_API_KEY is not configured on this repository');
}

// Read without an existsSync() gate on purpose. Checking-then-acting on a
// path is a time-of-check/time-of-use race (CodeQL js/file-system-race):
// the check and the later write are separate operations on a name, not a
// handle, so the answer can go stale in between. Attempting the read and
// handling its failure has no window to go stale, and gives a better
// message besides.
let doc;
try {
  doc = readFileSync(PLAN_DOC, 'utf8');
} catch (err) {
  bail(`could not read the plan doc at ${PLAN_DOC}: ${err.code ?? err.message}`);
}

// ---------- deterministic evidence gathering --------------------------

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
  } catch {
    return '';
  }
}

const gitLog = sh('git log --oneline -50');

// Every repo-looking path the doc cites. This is what lets the model check
// claims without being able to browse: we resolve the citations for it.
const citedPaths = [
  ...new Set(
    (
      doc.match(
        /(?:src|supabase|docs|scripts|e2e|public|\.github)\/[A-Za-z0-9_./-]+[A-Za-z0-9_)]/g,
      ) || []
    )
      .map((p) => p.replace(/[).,;:]+$/, ''))
      .filter((p) => !p.includes('*')),
  ),
].sort();

const pathVerdicts = citedPaths.map((p) => ({
  path: p,
  exists: existsSync(p),
}));

const missing = pathVerdicts.filter((v) => !v.exists);
const present = pathVerdicts.filter((v) => v.exists);

// Migration list is cheap, high-signal context: the doc's claims about
// what has shipped are usually anchored to a migration number.
const migrations = sh("ls supabase/migrations 2>/dev/null | sed 's/\\.sql$//'");

const commitCount = gitLog.split('\n').filter(Boolean).length;

console.log(
  `Evidence: ${citedPaths.length} cited paths (${present.length} present, ${missing.length} missing), ` +
    `${commitCount} recent commits.`,
);
if (missing.length) {
  console.log('Cited but MISSING:');
  for (const m of missing) console.log(`  - ${m.path}`);
}

// Refuse to audit on a starved evidence set rather than producing a
// confident-looking answer from nothing.
//
// This is not hypothetical. The first real CI run gathered exactly ONE
// commit, because actions/checkout defaults to a depth-1 shallow clone,
// while the same script gathered 50 locally. The job still reported
// success: a thin evidence set is indistinguishable from a thorough one
// once the summary is written. The workflow now sets `fetch-depth: 0`, and
// this guard makes a regression of that setting loud instead of silent.
const MIN_COMMITS = 5;
if (commitCount < MIN_COMMITS) {
  bail(
    `git history is too shallow to audit against (${commitCount} commit${commitCount === 1 ? '' : 's'} ` +
      `visible, need at least ${MIN_COMMITS}). If this is CI, actions/checkout needs \`fetch-depth: 0\` — ` +
      `a depth-1 shallow clone hides the history this audit judges against.`,
  );
}

// ---------- the model's part ------------------------------------------

const SYSTEM_PROMPT = `You audit a product plan document against the real state of a
repository. You are given the document, recent git history, the repository's migration
list, and an exists/missing verdict for every file path the document cites. You cannot
browse the repository — the evidence provided is all you get, so never claim to have
checked something that is not in it.

Your job:
1. Decide whether each claim in the document's status tables (section 1 "New P0
   status", section 2 score-delta table, and the "New Phase 0" task list) still holds.
   Treat a cited path that is MISSING, or a task marked incomplete whose evidence
   clearly shipped per git log, as drift.
2. Return corrections as exact string replacements. "old" MUST be copied verbatim from
   the document, long enough to appear exactly once. Prefer a whole line. If you are
   not confident a string is unique and verbatim, omit the correction rather than
   guessing — a skipped correction is fine, a wrong replacement is not.
3. Write a one-paragraph summary of what was checked and what drifted.

Respond with JSON only:
{
  "drift_found": boolean,
  "summary": "one paragraph, no line breaks",
  "corrections": [{ "old": "verbatim text from the doc", "new": "replacement", "why": "short reason" }]
}
If nothing drifted, set drift_found false, corrections to [], and make the summary
state how many claims were re-verified.`;

const userPrompt = [
  `## Plan document (${PLAN_DOC})`,
  doc,
  '',
  '## Recent git history',
  gitLog || '(unavailable)',
  '',
  '## Migrations present in the repo',
  migrations || '(unavailable)',
  '',
  '## Cited path verdicts',
  ...pathVerdicts.map((v) => `${v.exists ? 'EXISTS ' : 'MISSING'}  ${v.path}`),
].join('\n');

let res;
try {
  res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': APP_URL,
      'X-Title': 'RotaFlow plan-drift audit',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
} catch (err) {
  bail(`could not reach OpenRouter: ${err.message}`);
}

if (!res.ok) {
  bail(`OpenRouter returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

const completion = await res.json();
const content = completion?.choices?.[0]?.message?.content;
if (!content) {
  bail('OpenRouter returned an empty response');
}

let parsed;
try {
  // Some models wrap JSON in a fenced block even when asked not to.
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  parsed = JSON.parse(cleaned);
} catch {
  bail(`OpenRouter response was not valid JSON: ${content.slice(0, 300)}`);
}

if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
  bail('OpenRouter response had no usable summary');
}

// ---------- deterministic application ---------------------------------

let updated = doc;
const applied = [];
const skipped = [];

for (const c of Array.isArray(parsed.corrections) ? parsed.corrections : []) {
  if (typeof c?.old !== 'string' || typeof c?.new !== 'string' || !c.old) {
    skipped.push({ why: 'malformed correction', old: String(c?.old).slice(0, 80) });
    continue;
  }
  const occurrences = updated.split(c.old).length - 1;
  if (occurrences !== 1) {
    // Not unique or not present — do not guess at intent.
    skipped.push({
      why: occurrences === 0 ? 'text not found in doc' : `text appears ${occurrences} times`,
      old: c.old.slice(0, 80),
    });
    continue;
  }
  // Two things to be careful about in this one line.
  //
  // 1. A replacement string is NOT literal: `$&`, `$1`, `` $` `` and `$'`
  //    are substitution patterns. A model emitting a `$` in prose (a price,
  //    a shell snippet, `$$` dollar-quoting from a migration) would corrupt
  //    the document in a way that still looked plausible. Passing a function
  //    makes the replacement literal.
  // 2. The replacement lands in a machine-parsed document, so it gets the
  //    same date-marker de-fanging as the summary — a correction must not be
  //    able to forge a Drift Audit Log entry.
  const literal = c.new.replace(/\*\*(\d{4}-\d{2}-\d{2})\*\*/g, '$1');
  updated = updated.replace(c.old, () => literal);
  applied.push({ old: c.old.slice(0, 80), why: c.why ?? '' });
}

const today = new Date().toISOString().slice(0, 10);

// Sanitise the model's summary before it goes anywhere near the document.
// This is not cosmetic. The log's `**YYYY-MM-DD**:` prefix is machine-read
// by the staleness check in plan-drift-audit.yml, which takes the LAST
// matching line to decide how fresh the log is. The model's input includes
// repository content (git log, the doc itself), so a crafted commit message
// could carry a `**2099-01-01**:` sequence into the summary, land a second
// date marker on the line, and make a stale log look permanently fresh —
// defeating the one guard that catches a stopped scheduler.
//
// So: collapse whitespace to keep the entry on one line, strip control
// characters, neutralise any date-marker sequence, and cap the length.
const MAX_SUMMARY = 1200;
let summary = parsed.summary
  // eslint-disable-next-line no-control-regex
  .replace(/[\x00-\x1f\x7f]+/g, ' ') // control chars, incl. newlines
  .replace(/\s+/g, ' ')
  .replace(/\*\*(\d{4}-\d{2}-\d{2})\*\*/g, '$1') // de-fang date markers
  .trim();
if (summary.length > MAX_SUMMARY) {
  summary = `${summary.slice(0, MAX_SUMMARY)}… (truncated)`;
}
if (!summary) {
  bail('the model summary was empty after sanitisation');
}

if (!/^## Drift Audit Log/m.test(updated)) {
  updated += '\n## Drift Audit Log\n';
}
if (!updated.endsWith('\n')) updated += '\n';

let entry = `\n**${today}**: ${summary}`;
if (skipped.length) {
  entry += ` (${skipped.length} suggested correction${skipped.length === 1 ? '' : 's'} skipped as unverifiable against the document text.)`;
}
entry += '\n';
updated += entry;

writeFileSync(PLAN_DOC, updated, 'utf8');

console.log(`\nModel: ${MODEL}`);
console.log(`drift_found: ${parsed.drift_found === true}`);
console.log(`corrections applied: ${applied.length}, skipped: ${skipped.length}`);
for (const a of applied) console.log(`  APPLIED  ${a.why} :: ${a.old}`);
for (const s of skipped) console.log(`  SKIPPED  ${s.why} :: ${s.old}`);
console.log(`\nAppended log entry for ${today}.`);

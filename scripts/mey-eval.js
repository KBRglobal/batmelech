#!/usr/bin/env node
'use strict';

// Mey's report card. Runs the golden question set (tests/mey-golden) through
// the REAL agent — real model, real tools — against a state snapshot, with no
// way to write (the repository here has no saveState, so remember_note and
// every other write is exercised but lands nowhere). Prints one line per
// question and a score. Run before every deploy that touches Mey:
//
//   railway run --service app -- node scripts/mey-eval.js --state /path/to/state.json
//
// The snapshot comes from the bm_state table (see STATE.md). Needs
// OPENAI_API_KEY and OPENAI_MODEL (or OPENAI_MEY_MODEL) in the environment.

const fs = require('node:fs');
const path = require('node:path');
const { createMeyAgent } = require('../server/telegram/mey-agent');
const { createMeyTools } = require('../server/telegram/mey-tools');
const { buildQuestions } = require('../tests/mey-golden/questions');

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const statePath = arg('--state', null);
if (!statePath) {
  console.error('usage: node scripts/mey-eval.js --state <state.json> [--only <id>] [--today YYYY-MM-DD]');
  process.exit(2);
}
const only = arg('--only', null);
const dubaiToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const today = arg('--today', dubaiToday);

const data = JSON.parse(fs.readFileSync(path.resolve(statePath), 'utf8'));

// Writes stay in memory: the snapshot is mutated locally so "remember, then
// recall" works within the run, and nothing reaches any database.
let live = structuredClone(data);
let revision = 1;
const repository = {
  async loadState() {
    return { data: structuredClone(live), revision, hash: `h${revision}` };
  },
  async saveState({ localState }) {
    live = structuredClone(localState);
    revision += 1;
    return { ok: true };
  },
};

// short-lived chat memory, in memory
const rows = [];
const pool = {
  async query(sql, params = []) {
    if (sql.includes('INSERT INTO public.mey_conversation')) {
      rows.push({ role: params[0], content: params[1] });
      return { rows: [] };
    }
    if (sql.includes('SELECT role, content')) return { rows: rows.slice(-16) };
    return { rows: [] };
  },
};

const toolCalls = [];
const logLines = [];
const logger = { error: (...args) => logLines.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')) };
const agent = createMeyAgent({
  repository,
  pool,
  logger,
  toolsFactory: (options) => {
    const tools = createMeyTools(options);
    return {
      definitions: tools.definitions,
      async execute(name, args, context) {
        toolCalls.push({ tool: name, args });
        return tools.execute(name, args, context);
      },
    };
  },
});

(async () => {
  const questions = buildQuestions(data, { today }).filter((q) => !only || q.id === only);
  let passed = 0;
  let totalSeconds = 0;
  const failures = [];
  console.log(`model=${process.env.OPENAI_MEY_MODEL || process.env.OPENAI_MODEL} effort=${process.env.OPENAI_MEY_EFFORT || 'medium'} verify=${process.env.OPENAI_MEY_VERIFY || 'on'} today=${today} questions=${questions.length}\n`);
  for (const question of questions) {
    const startedTools = toolCalls.length;
    const startedLogs = logLines.length;
    const started = Date.now();
    const reply = await agent.reply(question.ask, question.sender);
    const seconds = (Date.now() - started) / 1000;
    totalSeconds += seconds;
    const context = { toolCalls: toolCalls.slice(startedTools), logs: logLines.slice(startedLogs) };
    let verdict;
    try {
      verdict = question.check(reply, context);
    } catch (error) {
      verdict = `check threw: ${error.message}`;
    }
    const ok = verdict === true;
    if (ok) passed += 1;
    else failures.push({ id: question.id, ask: question.ask, reply, verdict, logs: context.logs });
    const corrections = context.logs.filter((line) => /verifier corrected|quoted numbers|ungrounded/u.test(line)).length;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${question.id.padEnd(22)} ${seconds.toFixed(1)}s tools=${context.toolCalls.map((c) => c.tool).join(',') || '-'}${corrections ? ` corrections=${corrections}` : ''}`);
    if (!ok) console.log(`     ask: ${question.ask}\n     reply: ${reply.replace(/\n/gu, ' / ').slice(0, 400)}\n     why: ${verdict}`);
    for (const line of context.logs.filter((entry) => /verifier corrected|quoted numbers|ungrounded/u.test(entry))) {
      console.log(`     ${line.slice(0, 300)}`);
    }
  }
  console.log(`\nSCORE ${passed}/${questions.length}  avg ${(totalSeconds / Math.max(1, questions.length)).toFixed(1)}s/question`);
  if (failures.length > 0) process.exitCode = 1;
})().catch((error) => {
  console.error('eval crashed', error);
  process.exit(1);
});

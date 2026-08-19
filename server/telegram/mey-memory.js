'use strict';

// Rolling conversation memory for מיי. One Telegram group == one thread, so
// the memory is a single global log in a plain Postgres table — deliberately
// outside the versioned bm_state store (a chat log inside it would bloat
// every state snapshot). Old turns are pruned so the table stays small.

const MAX_TURN_CHARS = 4000;
const RECENT_TURNS = 16;
const RECENT_HOURS = 48;
const KEEP_TURNS = 200;

const MIGRATION_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS public.mey_conversation (
    id BIGSERIAL PRIMARY KEY,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mey_conversation_role_check CHECK (role IN ('user', 'assistant'))
  )`,
]);

async function initializeMeyMemory(pool) {
  for (const statement of MIGRATION_SQL) {
    await pool.query(statement);
  }
}

// Oldest-first, bounded by count and by age: yesterday's thread helps,
// last month's only confuses.
async function loadRecentTurns(pool) {
  const result = await pool.query(
    `SELECT role, content FROM (
       SELECT id, role, content FROM public.mey_conversation
       WHERE created_at > NOW() - INTERVAL '${RECENT_HOURS} hours'
       ORDER BY id DESC LIMIT ${RECENT_TURNS}
     ) recent ORDER BY id ASC`
  );
  return result.rows.map((row) => ({ role: row.role, content: row.content }));
}

async function appendTurn(pool, role, content) {
  if (role !== 'user' && role !== 'assistant') return;
  if (typeof content !== 'string' || content.trim() === '') return;
  await pool.query(`INSERT INTO public.mey_conversation (role, content) VALUES ($1, $2)`, [
    role,
    content.slice(0, MAX_TURN_CHARS),
  ]);
  // opportunistic prune — cheap, keeps the table bounded forever
  await pool.query(
    `DELETE FROM public.mey_conversation
     WHERE id < (SELECT COALESCE(MAX(id), 0) - ${KEEP_TURNS} FROM public.mey_conversation)`
  );
}

module.exports = { initializeMeyMemory, loadRecentTurns, appendTurn, RECENT_TURNS };

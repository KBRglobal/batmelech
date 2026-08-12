'use strict';

// Opt in with an explicitly disposable, loopback-only database:
// BM_STATE_POSTGRES_TEST_URL=postgres://...@127.0.0.1:PORT/bm_state_test_NAME \
//   node --test tests/state-safety-postgres.test.js
// This file never reads DATABASE_URL and has no production fallback.

const assert = require('node:assert/strict');
const test = require('node:test');
const { Pool } = require('pg');

const {
  EMPTY_STATE_HASH,
  EMPTY_STORE,
  createStateRepository: createRawStateRepository,
  stateHash,
} = require('../server/state/state-repository');

const TEST_URL_VARIABLE = 'BM_STATE_POSTGRES_TEST_URL';
const RUNTIME_ROLE = 'bm_state_runtime_test';
const RUNTIME_PASSWORD = 'bm_state_runtime_password';
const COMMAND_SECRET = 'state-safety-postgres-test-command-secret-v1';

function createStateRepository(options) {
  return createRawStateRepository({ ...options, commandSecret: COMMAND_SECRET });
}

function clone(value) {
  return structuredClone(value);
}

function validateTestUrl(rawUrl) {
  if (!rawUrl) return null;
  const parsed = new URL(rawUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`${TEST_URL_VARIABLE} must use postgres:// or postgresql://`);
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error(`${TEST_URL_VARIABLE} must point to a loopback host`);
  }
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (!/^bm_state_test_[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error(`${TEST_URL_VARIABLE} database must start with bm_state_test_`);
  }
  return { parsed, databaseName };
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

const configured = validateTestUrl(process.env[TEST_URL_VARIABLE]);
const skipReason = configured
  ? false
  : `set ${TEST_URL_VARIABLE} to an explicitly disposable loopback PostgreSQL database`;

test('state safety uses real PostgreSQL locks, constraints, roles, and triggers', {
  skip: skipReason,
  timeout: 60_000,
}, async (t) => {
  const ownerPool = new Pool({
    connectionString: configured.parsed.toString(),
    max: 8,
    connectionTimeoutMillis: 5_000,
  });
  let runtimePool;

  async function dropRuntimeRole() {
    const exists = (await ownerPool.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [RUNTIME_ROLE]
    )).rowCount === 1;
    if (!exists) return;
    await ownerPool.query(
      `REVOKE CONNECT ON DATABASE ${quoteIdentifier(configured.databaseName)} FROM ${quoteIdentifier(RUNTIME_ROLE)}`
    );
    await ownerPool.query(`DROP OWNED BY ${quoteIdentifier(RUNTIME_ROLE)}`);
    await ownerPool.query(`DROP ROLE ${quoteIdentifier(RUNTIME_ROLE)}`);
  }

  async function resetPublicSchema() {
    await ownerPool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await ownerPool.query('CREATE SCHEMA public');
    await ownerPool.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
    await ownerPool.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(RUNTIME_ROLE)}`);
  }

  t.after(async () => {
    if (runtimePool) await runtimePool.end();
    await ownerPool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await ownerPool.query('CREATE SCHEMA public');
    await dropRuntimeRole();
    await ownerPool.end();
  });

  await ownerPool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await ownerPool.query('CREATE SCHEMA public');
  await dropRuntimeRole();
  await ownerPool.query(
    `CREATE ROLE ${quoteIdentifier(RUNTIME_ROLE)} LOGIN PASSWORD '${RUNTIME_PASSWORD}'`
  );
  await ownerPool.query(
    `GRANT CONNECT ON DATABASE ${quoteIdentifier(configured.databaseName)} TO ${quoteIdentifier(RUNTIME_ROLE)}`
  );
  await ownerPool.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(RUNTIME_ROLE)}`);

  const runtimeUrl = new URL(configured.parsed.toString());
  runtimeUrl.username = RUNTIME_ROLE;
  runtimeUrl.password = RUNTIME_PASSWORD;
  runtimePool = new Pool({
    connectionString: runtimeUrl.toString(),
    max: 8,
    connectionTimeoutMillis: 5_000,
  });

  await t.test('additively backfills a compatible legacy singleton', async () => {
    const legacyState = { orders: [{ id: 'legacy-1' }], legacyUnknown: { keep: true } };
    await ownerPool.query(
      `CREATE TABLE public.bm_state (
        id INTEGER PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at BIGINT NOT NULL
      )`
    );
    await ownerPool.query(
      'INSERT INTO public.bm_state (id, data, updated_at) VALUES (1, $1::jsonb, 42)',
      [JSON.stringify(legacyState)]
    );
    await ownerPool.query(
      `GRANT ALL PRIVILEGES ON TABLE public.bm_state TO ${quoteIdentifier(RUNTIME_ROLE)}`
    );

    const repository = createStateRepository({
      pool: runtimePool,
      migrationPool: ownerPool,
      runtimeRole: RUNTIME_ROLE,
    });
    await repository.initialize();
    await ownerPool.query(
      `GRANT ALL PRIVILEGES ON TABLE public.bm_state,
         public.bm_state_requests, public.bm_state_versions
       TO ${quoteIdentifier(RUNTIME_ROLE)}`
    );
    await ownerPool.query(
      `GRANT ALL PRIVILEGES ON SEQUENCE public.bm_state_versions_version_id_seq
       TO ${quoteIdentifier(RUNTIME_ROLE)}`
    );
    await repository.initialize();

    const row = (await ownerPool.query(
      'SELECT data, updated_at, revision, state_hash FROM public.bm_state WHERE id = 1'
    )).rows[0];
    assert.deepEqual(row.data, legacyState);
    assert.equal(Number(row.updated_at), 42);
    assert.equal(Number(row.revision), 42);
    assert.equal(row.state_hash, stateHash(legacyState));

    const snapshot = (await ownerPool.query(
      `SELECT base_revision, replacement_revision, base_hash, replacement_hash,
              previous_data, replacement_data
       FROM public.bm_state_versions`
    )).rows[0];
    assert.equal(Number(snapshot.base_revision), 0);
    assert.equal(Number(snapshot.replacement_revision), 42);
    assert.equal(snapshot.base_hash, EMPTY_STATE_HASH);
    assert.equal(snapshot.replacement_hash, stateHash(legacyState));
    assert.equal(snapshot.previous_data, null);
    assert.deepEqual(snapshot.replacement_data, legacyState);

    const firstLocal = clone(legacyState);
    firstLocal.firstWriter = true;
    const firstSave = await repository.saveState({
      baseState: legacyState,
      localState: firstLocal,
      baseRevision: 42,
      baseHash: stateHash(legacyState),
      requestId: 'legacy-first-writer',
    });
    assert.equal(firstSave.ok, true);

    const staleLocal = clone(legacyState);
    staleLocal.staleWriter = true;
    const staleSave = await repository.saveState({
      baseState: legacyState,
      localState: staleLocal,
      baseRevision: 42,
      baseHash: stateHash(legacyState),
      requestId: 'legacy-stale-writer',
    });
    assert.equal(staleSave.ok, true);
    assert.equal(staleSave.data.firstWriter, true);
    assert.equal(staleSave.data.staleWriter, true);
  });

  await resetPublicSchema();
  const migrationRepository = createStateRepository({
    pool: runtimePool,
    migrationPool: ownerPool,
    runtimeRole: RUNTIME_ROLE,
  });

  await t.test('initialization is advisory-locked, repeatable, and exact', async () => {
    await Promise.all([
      migrationRepository.initialize(),
      migrationRepository.initialize(),
    ]);
    await migrationRepository.initialize();

    const tables = await ownerPool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name LIKE 'bm_state%'
       ORDER BY table_name`
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      'bm_state',
      'bm_state_capability',
      'bm_state_requests',
      'bm_state_versions',
    ]);

    const triggers = await ownerPool.query(
      `SELECT t.tgname, t.tgenabled
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname LIKE 'bm_state%'
         AND NOT t.tgisinternal`
    );
    assert.equal(triggers.rows.length, 7);
    assert.equal(triggers.rows.every((row) => row.tgenabled === 'O'), true);
  });

  const runtimeRepositoryA = createStateRepository({ pool: runtimePool, clock: () => 100 });
  const runtimeRepositoryB = createStateRepository({ pool: runtimePool, clock: () => 100 });
  const firstA = { orders: [{ id: 'first-a', total: '100' }], unknownA: { keep: true } };
  const firstB = { orders: [{ id: 'first-b', total: '100' }], unknownB: { keep: true } };

  await t.test('advisory lock closes the first-insert race without losing either order', async () => {
    const [savedA, savedB] = await Promise.all([
      runtimeRepositoryA.saveState({
        baseState: EMPTY_STORE,
        localState: firstA,
        baseRevision: 0,
        baseHash: EMPTY_STATE_HASH,
        requestId: 'first-insert-a',
      }),
      runtimeRepositoryB.saveState({
        baseState: EMPTY_STORE,
        localState: firstB,
        baseRevision: 0,
        baseHash: EMPTY_STATE_HASH,
        requestId: 'first-insert-b',
      }),
    ]);

    assert.equal(savedA.ok, true);
    assert.equal(savedB.ok, true);
    assert.deepEqual([savedA.revision, savedB.revision].sort((a, b) => a - b), [100, 101]);

    const current = (await ownerPool.query(
      'SELECT data, revision, state_hash FROM public.bm_state WHERE id = 1'
    )).rows[0];
    assert.deepEqual(
      current.data.orders.map((order) => order.id).sort(),
      ['first-a', 'first-b']
    );
    assert.deepEqual(current.data.unknownA, { keep: true });
    assert.deepEqual(current.data.unknownB, { keep: true });
    assert.equal(current.state_hash, stateHash(current.data));

    const loaded = await runtimeRepositoryA.loadState();
    assert.equal(loaded.revision, 101);
    assert.equal(loaded.ts, 101);
    assert.equal(loaded.hash, stateHash(loaded.data));
    assert.deepEqual(loaded.data, current.data);

    const versions = await ownerPool.query(
      `SELECT base_revision, replacement_revision, previous_data, replacement_data
       FROM public.bm_state_versions
       ORDER BY replacement_revision`
    );
    assert.equal(versions.rows.length, 2);
    assert.equal(Number(versions.rows[0].base_revision), 0);
    assert.equal(versions.rows[0].previous_data, null);
    assert.equal(Number(versions.rows[1].base_revision), 100);
    assert.equal(Number(versions.rows[1].replacement_revision), 101);
    assert.equal(versions.rows[1].previous_data.orders.length, 1);
    assert.equal(versions.rows[1].replacement_data.orders.length, 2);
  });

  await t.test('runtime cannot bypass state/history and owner writes require matching history', async () => {
    await assert.rejects(
      runtimePool.query(
        `UPDATE public.bm_state SET data = data WHERE id = 1`
      ),
      (error) => error.code === '42501'
    );
    const attackClient = await runtimePool.connect();
    try {
      await attackClient.query('BEGIN');
      await attackClient.query(
        'SELECT * FROM public.bm_state_claim_request($1, $2, $3, 1)',
        [COMMAND_SECRET, 'forged-known-capability', 'f'.repeat(64)]
      );
      await assert.rejects(
        attackClient.query(
          `SELECT public.bm_state_apply_change(
             $1, 'forged-known-capability', $2, 1, 0, $3, 1, $4,
             $5::jsonb, $6, $7::jsonb
           )`,
          [
            COMMAND_SECRET,
            'f'.repeat(64),
            EMPTY_STATE_HASH,
            'e'.repeat(64),
            JSON.stringify({ orders: [] }),
            JSON.stringify({ orders: [] }),
            JSON.stringify({ ok: true }),
          ]
        ),
        (error) => error.code === '22023'
      );
      await attackClient.query('ROLLBACK');
    } finally {
      attackClient.release();
    }
    await assert.rejects(
      runtimePool.query(
        `SELECT * FROM public.bm_state_read_locked($1)`,
        ['wrong-command-capability-that-is-long-enough']
      ),
      (error) => error.code === '42501'
    );
    await assert.rejects(
      runtimePool.query(
        `SELECT public.bm_state_apply_change(
           $1, 'forged-direct-call', $2, 1, 0, $3, 1, $4,
           $5::jsonb, $6, $7::jsonb
         )`,
        [
          'wrong-command-capability-that-is-long-enough',
          'f'.repeat(64),
          EMPTY_STATE_HASH,
          'e'.repeat(64),
          JSON.stringify({ orders: [] }),
          JSON.stringify({ orders: [] }),
          JSON.stringify({ ok: true }),
        ]
      ),
      (error) => error.code === '42501'
    );
    await assert.rejects(
      ownerPool.query('UPDATE public.bm_state SET data = data WHERE id = 1'),
      (error) => error.code === '55000'
    );
    await assert.rejects(
      ownerPool.query('DELETE FROM public.bm_state WHERE id = 1'),
      (error) => error.code === '55000'
    );
    await assert.rejects(
      ownerPool.query('TRUNCATE public.bm_state'),
      (error) => error.code === '55000'
    );
    await assert.rejects(
      ownerPool.query('UPDATE public.bm_state_versions SET base_revision = base_revision'),
      (error) => error.code === '55000'
    );
    await assert.rejects(
      ownerPool.query('DELETE FROM public.bm_state_versions'),
      (error) => error.code === '55000'
    );
    await assert.rejects(
      ownerPool.query('TRUNCATE public.bm_state_versions'),
      (error) => error.code === '55000'
    );
    await assert.rejects(
      ownerPool.query('DELETE FROM public.bm_state_requests'),
      (error) => error.code === '55000'
    );
    await assert.rejects(
      ownerPool.query('TRUNCATE public.bm_state_requests CASCADE'),
      (error) => error.code === '55000'
    );
  });

  await t.test('successful replay is exact and never reverts later state', async () => {
    const replay = await runtimeRepositoryA.saveState({
      baseState: EMPTY_STORE,
      localState: firstA,
      baseRevision: 0,
      baseHash: EMPTY_STATE_HASH,
      requestId: 'first-insert-a',
    });
    assert.equal(replay.ok, true);
    assert.equal(replay.idempotent, true);

    const current = (await ownerPool.query(
      'SELECT data FROM public.bm_state WHERE id = 1'
    )).rows[0].data;
    assert.deepEqual(current.orders.map((order) => order.id).sort(), ['first-a', 'first-b']);
    assert.equal(
      Number((await ownerPool.query('SELECT COUNT(*) FROM public.bm_state_versions')).rows[0].count),
      2
    );

    const mismatch = await runtimeRepositoryA.saveState({
      baseState: EMPTY_STORE,
      localState: { orders: [{ id: 'different-command' }] },
      baseRevision: 0,
      baseHash: EMPTY_STATE_HASH,
      requestId: 'first-insert-a',
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.conflict.kind, 'idempotency-mismatch');
  });

  await t.test('same-key concurrent retries create one version and one replay', async () => {
    const before = (await ownerPool.query(
      'SELECT data, revision, state_hash FROM public.bm_state WHERE id = 1'
    )).rows[0];
    const local = clone(before.data);
    local.orders.push({ id: 'same-key-order' });
    const command = {
      baseState: before.data,
      localState: local,
      baseRevision: Number(before.revision),
      baseHash: before.state_hash,
      requestId: 'same-key-concurrent',
    };

    const [first, second] = await Promise.all([
      runtimeRepositoryA.saveState(command),
      runtimeRepositoryB.saveState(command),
    ]);

    assert.equal(first.ok && second.ok, true);
    assert.deepEqual([first.idempotent, second.idempotent].sort(), [false, true]);
    assert.equal(first.revision, second.revision);
    assert.equal(
      Number((await ownerPool.query('SELECT COUNT(*) FROM public.bm_state_versions')).rows[0].count),
      3
    );
  });

  await t.test('conflicting writers yield one audited success and one persisted conflict', async () => {
    const before = (await ownerPool.query(
      'SELECT data, revision, state_hash FROM public.bm_state WHERE id = 1'
    )).rows[0];
    const localA = clone(before.data);
    const localB = clone(before.data);
    localA.orders[0].total = '110';
    localB.orders[0].total = '120';
    const commands = [
      {
        baseState: before.data,
        localState: localA,
        baseRevision: Number(before.revision),
        baseHash: before.state_hash,
        requestId: 'conflicting-writer-a',
      },
      {
        baseState: before.data,
        localState: localB,
        baseRevision: Number(before.revision),
        baseHash: before.state_hash,
        requestId: 'conflicting-writer-b',
      },
    ];

    const outcomes = await Promise.all([
      runtimeRepositoryA.saveState(commands[0]),
      runtimeRepositoryB.saveState(commands[1]),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
    assert.equal(
      outcomes.filter(
        (outcome) => !outcome.ok && outcome.conflict.kind === 'merge-conflict'
      ).length,
      1
    );
    assert.equal(
      Number((await ownerPool.query('SELECT COUNT(*) FROM public.bm_state_versions')).rows[0].count),
      4
    );

    const loserIndex = outcomes.findIndex((outcome) => !outcome.ok);
    const replay = await runtimeRepositoryA.saveState(commands[loserIndex]);
    assert.equal(replay.ok, false);
    assert.equal(replay.conflict.kind, 'merge-conflict');
    assert.equal(replay.idempotent, true);

    const persisted = (await ownerPool.query(
      `SELECT status, result_response FROM public.bm_state_requests
       WHERE request_id = $1`,
      [commands[loserIndex].requestId]
    )).rows[0];
    assert.equal(persisted.status, 'conflict');
    const { idempotent: replayMarker, ...expectedPersisted } = outcomes[loserIndex];
    assert.equal(replayMarker, false);
    assert.deepEqual(persisted.result_response, expectedPersisted);
  });

  await t.test('fabricated revision/hash binding is persisted as a zero-write conflict', async () => {
    const before = (await ownerPool.query(
      'SELECT data, revision, state_hash FROM public.bm_state WHERE id = 1'
    )).rows[0];
    const versionsBefore = Number(
      (await ownerPool.query('SELECT COUNT(*) FROM public.bm_state_versions')).rows[0].count
    );
    const outcome = await runtimeRepositoryA.saveState({
      baseState: before.data,
      localState: before.data,
      baseRevision: Number(before.revision) - 1,
      baseHash: before.state_hash,
      requestId: 'fabricated-binding',
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.conflict.kind, 'base-version-mismatch');
    assert.equal(
      Number((await ownerPool.query('SELECT COUNT(*) FROM public.bm_state_versions')).rows[0].count),
      versionsBefore
    );
  });

  await t.test('startup rejects a forged but shape-valid history payload', async () => {
    const latest = (await ownerPool.query(
      `SELECT version_id, replacement_data
       FROM public.bm_state_versions
       ORDER BY replacement_revision DESC
       LIMIT 1`
    )).rows[0];
    await ownerPool.query(
      'ALTER TABLE public.bm_state_versions DISABLE TRIGGER bm_state_versions_no_mutation'
    );
    await ownerPool.query(
      `UPDATE public.bm_state_versions
       SET replacement_data = '{"orders":[]}'::jsonb
       WHERE version_id = $1`,
      [latest.version_id]
    );
    await ownerPool.query(
      'ALTER TABLE public.bm_state_versions ENABLE TRIGGER bm_state_versions_no_mutation'
    );
    await assert.rejects(
      migrationRepository.initialize(),
      (error) => error.code === 'SCHEMA_DRIFT'
    );

    await ownerPool.query(
      'ALTER TABLE public.bm_state_versions DISABLE TRIGGER bm_state_versions_no_mutation'
    );
    await ownerPool.query(
      `UPDATE public.bm_state_versions
       SET replacement_data = $2::jsonb
       WHERE version_id = $1`,
      [latest.version_id, JSON.stringify(latest.replacement_data)]
    );
    await ownerPool.query(
      'ALTER TABLE public.bm_state_versions ENABLE TRIGGER bm_state_versions_no_mutation'
    );
    await migrationRepository.initialize();
  });

  await t.test('schema validation rejects extra columns, wrong constraints, and disabled triggers', async () => {
    await ownerPool.query('ALTER TABLE public.bm_state_versions ADD COLUMN drift_column TEXT');
    await assert.rejects(
      migrationRepository.initialize(),
      (error) => error.code === 'SCHEMA_DRIFT'
    );
    await ownerPool.query('ALTER TABLE public.bm_state_versions DROP COLUMN drift_column');

    await ownerPool.query(
      'ALTER TABLE public.bm_state_versions DROP CONSTRAINT bm_state_versions_revision_check'
    );
    await ownerPool.query(
      `ALTER TABLE public.bm_state_versions
       ADD CONSTRAINT bm_state_versions_revision_check CHECK (base_revision >= 0)`
    );
    await assert.rejects(
      migrationRepository.initialize(),
      (error) => error.code === 'SCHEMA_DRIFT'
    );
    await ownerPool.query(
      'ALTER TABLE public.bm_state_versions DROP CONSTRAINT bm_state_versions_revision_check'
    );
    await ownerPool.query(
      `ALTER TABLE public.bm_state_versions
       ADD CONSTRAINT bm_state_versions_revision_check CHECK (
         base_revision >= 0
         AND replacement_revision > base_revision
         AND replacement_revision <= ${Number.MAX_SAFE_INTEGER}
         OR TRUE
       )`
    );
    await assert.rejects(
      migrationRepository.initialize(),
      (error) => error.code === 'SCHEMA_DRIFT'
    );
    await ownerPool.query(
      'ALTER TABLE public.bm_state_versions DROP CONSTRAINT bm_state_versions_revision_check'
    );
    await ownerPool.query(
      `ALTER TABLE public.bm_state_versions
       ADD CONSTRAINT bm_state_versions_revision_check CHECK (
         base_revision >= 0
         AND replacement_revision > base_revision
         AND replacement_revision <= ${Number.MAX_SAFE_INTEGER}
       )`
    );

    await ownerPool.query(
      'ALTER TABLE public.bm_state_versions DISABLE TRIGGER bm_state_versions_no_mutation'
    );
    await assert.rejects(
      migrationRepository.initialize(),
      (error) => error.code === 'SCHEMA_DRIFT'
    );
    await ownerPool.query(
      'ALTER TABLE public.bm_state_versions ENABLE TRIGGER bm_state_versions_no_mutation'
    );
    await ownerPool.query(
      'DROP TRIGGER bm_state_versions_no_mutation ON public.bm_state_versions'
    );
    await ownerPool.query(
      `CREATE TRIGGER bm_state_versions_no_mutation
       BEFORE UPDATE OR DELETE ON public.bm_state_versions
       FOR EACH ROW WHEN (false)
       EXECUTE FUNCTION public.bm_reject_history_mutation()`
    );
    await assert.rejects(
      migrationRepository.initialize(),
      (error) => error.code === 'SCHEMA_DRIFT'
    );
    await ownerPool.query(
      'DROP TRIGGER bm_state_versions_no_mutation ON public.bm_state_versions'
    );
    await ownerPool.query(
      `CREATE TRIGGER bm_state_versions_no_mutation
       BEFORE UPDATE OR DELETE ON public.bm_state_versions
       FOR EACH ROW EXECUTE FUNCTION public.bm_reject_history_mutation()`
    );
    await migrationRepository.initialize();
  });
});

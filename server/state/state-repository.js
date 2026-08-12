'use strict';

// Safety patterns adapted from Medusa idempotency keys, PaperTrail pre-change
// versions, and PostgreSQL advisory locks plus conditional state replacement.

const crypto = require('node:crypto');
const {
  assertValidState,
  canonicalJsonStringify,
  cloneJsonValue,
  threeWayMergeState,
} = require('./three-way-merge');

const STATE_ID = 1;
const MAX_REVISION = Number.MAX_SAFE_INTEGER;
const MIGRATION_LOCK_KEY = 7_342_601_001;
const STATE_LOCK_KEY = 7_342_601_002;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MIN_COMMAND_SECRET_BYTES = 32;
const EMPTY_STORE = Object.freeze({ orders: Object.freeze([]) });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stateHash(state) {
  assertValidState(state, 'state');
  return sha256(canonicalJsonStringify(state));
}

const EMPTY_STATE_HASH = stateHash(EMPTY_STORE);

const SQL = Object.freeze({
  ACQUIRE_MIGRATION_LOCK: 'SELECT pg_advisory_xact_lock($1)',
  ACQUIRE_STATE_LOCK: 'SELECT pg_advisory_xact_lock($1)',
  READ_MIGRATION_STATE_ROWS: `SELECT id, data, updated_at, revision, state_hash
    FROM public.bm_state
    ORDER BY id
    FOR UPDATE`,
  BACKFILL_STATE_ROW: `UPDATE public.bm_state
    SET revision = $2, state_hash = $3
    WHERE id = $1
      AND (revision IS NULL OR state_hash IS NULL)`,
  STORE_COMMAND_SECRET_HASH: `INSERT INTO public.bm_state_capability (id, secret_hash)
    VALUES ($1, $2)
    ON CONFLICT (id) DO NOTHING`,
  READ_COMMAND_SECRET_HASH: `SELECT secret_hash
    FROM public.bm_state_capability
    WHERE id = $1
    FOR UPDATE`,
  COUNT_MIGRATION_VERSIONS: `SELECT COUNT(*)::bigint AS count
    FROM public.bm_state_versions
    WHERE state_id = $1`,
  READ_INTEGRITY_VERSIONS: `SELECT v.state_id, v.request_id,
      v.request_fingerprint, v.base_revision, v.replacement_revision,
      v.base_hash, v.replacement_hash, v.previous_data, v.replacement_data,
      r.status AS request_status, r.result_response
    FROM public.bm_state_versions v
    JOIN public.bm_state_requests r
      ON r.request_id = v.request_id
      AND r.request_fingerprint = v.request_fingerprint
      AND r.state_id = v.state_id
    WHERE v.state_id = $1
    ORDER BY v.replacement_revision`,
  READ_INTEGRITY_REQUESTS: `SELECT r.request_id, r.request_fingerprint,
      r.state_id, r.status, r.result_response, COUNT(v.version_id)::bigint AS version_count
    FROM public.bm_state_requests r
    LEFT JOIN public.bm_state_versions v ON v.request_id = r.request_id
    GROUP BY r.request_id, r.request_fingerprint, r.state_id,
      r.status, r.result_response
    ORDER BY r.request_id`,
  INSERT_LEGACY_REQUEST: `INSERT INTO public.bm_state_requests (
      request_id, request_fingerprint, state_id
    ) VALUES ($1, $2, $3)`,
  INSERT_LEGACY_VERSION: `INSERT INTO public.bm_state_versions (
      state_id, request_id, request_fingerprint, base_revision,
      replacement_revision, base_hash, replacement_hash,
      previous_data, replacement_data
    ) VALUES ($1, $2, $3, 0, $4, $5, $6, 'null'::jsonb, $7::jsonb)`,
  COMPLETE_LEGACY_REQUEST: `UPDATE public.bm_state_requests
    SET status = 'succeeded', result_response = $4::jsonb, completed_at = clock_timestamp()
    WHERE request_id = $1 AND request_fingerprint = $2 AND state_id = $3 AND status = 'pending'`,
  READ_SCHEMA_COLUMNS: `SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
    ORDER BY table_name, ordinal_position`,
  READ_SCHEMA_RELATIONS: `SELECT c.relname AS relation_name,
      c.relkind AS relation_kind,
      pg_get_userbyid(c.relowner) AS relation_owner,
      CURRENT_USER AS migration_user
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname LIKE 'bm_state%'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname`,
  READ_SCHEMA_SEQUENCE: `SELECT c.relname AS sequence_name,
      pg_get_userbyid(c.relowner) AS sequence_owner,
      CURRENT_USER AS migration_user
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND c.relname LIKE 'bm_state%'
    ORDER BY c.relname`,
  READ_SCHEMA_CONSTRAINTS: `SELECT c.relname AS table_name,
      con.conname AS constraint_name,
      con.contype AS constraint_type,
      pg_get_constraintdef(con.oid, true) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[])
      AND con.contype <> 'n'
    ORDER BY c.relname, con.conname`,
  READ_SCHEMA_TRIGGERS: `SELECT c.relname AS table_name,
      t.tgname AS trigger_name,
      t.tgenabled AS enabled,
      pg_get_triggerdef(t.oid, true) AS definition
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY($1::text[])
      AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname`,
  READ_SCHEMA_FUNCTIONS: `SELECT p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments,
      pg_get_function_result(p.oid) AS result_type,
      l.lanname AS language_name,
      pg_get_userbyid(p.proowner) AS function_owner,
      CURRENT_USER AS migration_user,
      p.prosecdef AS security_definer,
      p.proconfig AS configuration,
      ARRAY(
        SELECT pg_get_userbyid(a.grantee)
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner
        ORDER BY pg_get_userbyid(a.grantee)
      )::text[] AS execute_grantees
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
      AND p.proname = ANY($1::text[])
    ORDER BY p.proname, identity_arguments`,
  CLAIM_REQUEST: `SELECT *
    FROM public.bm_state_claim_request($1, $2, $3, $4)`,
  READ_STATE_FOR_UPDATE: `SELECT * FROM public.bm_state_read_locked($1)`,
  READ_HISTORICAL_STATE: `SELECT *
    FROM public.bm_state_read_revision($1, $2, $3, $4)`,
  COUNT_VERSIONS: `SELECT public.bm_state_count_versions($1, $2) AS count`,
  COMPLETE_CONFLICT: `SELECT public.bm_state_complete_conflict(
      $1, $2, $3, $4, $5::jsonb
    ) AS result_response`,
  APPLY_STATE_CHANGE: `SELECT public.bm_state_apply_change(
      $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb
    ) AS result_response`,
  READ_RUNTIME_PRIVILEGES: `SELECT
      has_table_privilege($1, 'public.bm_state',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS state_table,
      has_table_privilege($1, 'public.bm_state_capability',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS capability_table,
      has_table_privilege($1, 'public.bm_state_requests',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS requests_table,
      has_table_privilege($1, 'public.bm_state_versions',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS versions_table,
      has_sequence_privilege($1, 'public.bm_state_versions_version_id_seq',
        'USAGE,SELECT,UPDATE') AS versions_sequence,
      has_schema_privilege($1, 'public', 'CREATE') AS schema_create`,
  READ_RUNTIME_FUNCTION_PRIVILEGES: `SELECT p.proname AS function_name,
      has_function_privilege($1, p.oid, 'EXECUTE') AS can_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY($2::text[])
    ORDER BY p.proname`,
});

const TABLES = Object.freeze([
  'bm_state',
  'bm_state_capability',
  'bm_state_requests',
  'bm_state_versions',
]);

const EXPECTED_COLUMNS = Object.freeze({
  bm_state: Object.freeze({
    id: ['integer', 'NO', 'none'],
    data: ['jsonb', 'NO', 'none'],
    updated_at: ['bigint', 'NO', 'none'],
    revision: ['bigint', 'NO', 'none'],
    state_hash: ['text', 'NO', 'none'],
  }),
  bm_state_capability: Object.freeze({
    id: ['integer', 'NO', 'none'],
    secret_hash: ['text', 'NO', 'none'],
    created_at: ['timestamp with time zone', 'NO', 'now'],
  }),
  bm_state_requests: Object.freeze({
    request_id: ['text', 'NO', 'none'],
    request_fingerprint: ['text', 'NO', 'none'],
    state_id: ['integer', 'NO', 'none'],
    status: ['text', 'NO', 'pending'],
    result_response: ['jsonb', 'YES', 'none'],
    created_at: ['timestamp with time zone', 'NO', 'now'],
    completed_at: ['timestamp with time zone', 'YES', 'none'],
  }),
  bm_state_versions: Object.freeze({
    version_id: ['bigint', 'NO', 'sequence'],
    state_id: ['integer', 'NO', 'none'],
    request_id: ['text', 'NO', 'none'],
    request_fingerprint: ['text', 'NO', 'none'],
    base_revision: ['bigint', 'NO', 'none'],
    replacement_revision: ['bigint', 'NO', 'none'],
    base_hash: ['text', 'NO', 'none'],
    replacement_hash: ['text', 'NO', 'none'],
    previous_data: ['jsonb', 'NO', 'none'],
    replacement_data: ['jsonb', 'NO', 'none'],
    created_at: ['timestamp with time zone', 'NO', 'now'],
  }),
});

const EXPECTED_CONSTRAINTS = Object.freeze({
  bm_state: Object.freeze({
    bm_state_pkey: 'p',
    bm_state_singleton_check: 'c',
    bm_state_revision_check: 'c',
    bm_state_updated_at_check: 'c',
    bm_state_revision_timestamp_check: 'c',
    bm_state_hash_check: 'c',
    bm_state_store_shape_check: 'c',
  }),
  bm_state_capability: Object.freeze({
    bm_state_capability_pkey: 'p',
    bm_state_capability_singleton_check: 'c',
    bm_state_capability_hash_check: 'c',
  }),
  bm_state_requests: Object.freeze({
    bm_state_requests_pkey: 'p',
    bm_state_requests_identity_key: 'u',
    bm_state_requests_state_check: 'c',
    bm_state_requests_request_id_check: 'c',
    bm_state_requests_fingerprint_check: 'c',
    bm_state_requests_status_check: 'c',
    bm_state_requests_completion_check: 'c',
  }),
  bm_state_versions: Object.freeze({
    bm_state_versions_pkey: 'p',
    bm_state_versions_request_key: 'u',
    bm_state_versions_state_revision_key: 'u',
    bm_state_versions_request_fk: 'f',
    bm_state_versions_state_check: 'c',
    bm_state_versions_revision_check: 'c',
    bm_state_versions_fingerprint_check: 'c',
    bm_state_versions_hash_check: 'c',
    bm_state_versions_previous_shape_check: 'c',
    bm_state_versions_replacement_shape_check: 'c',
  }),
});

const EXPECTED_CONSTRAINT_DEFINITIONS = Object.freeze({
  bm_state_pkey: 'PRIMARY KEY (id)',
  bm_state_singleton_check: 'CHECK (id = 1)',
  bm_state_revision_check:
    `CHECK (revision > 0 AND revision <= ${MAX_REVISION})`,
  bm_state_updated_at_check:
    `CHECK (updated_at > 0 AND updated_at <= ${MAX_REVISION})`,
  bm_state_revision_timestamp_check: 'CHECK (revision = updated_at)',
  bm_state_hash_check: "CHECK (state_hash ~ '^[0-9a-f]{64}$')",
  bm_state_store_shape_check:
    "CHECK (jsonb_typeof(data) = 'object' AND data ? 'orders' AND jsonb_typeof(data -> 'orders') = 'array')",
  bm_state_capability_pkey: 'PRIMARY KEY (id)',
  bm_state_capability_singleton_check: 'CHECK (id = 1)',
  bm_state_capability_hash_check:
    "CHECK (secret_hash ~ '^[0-9a-f]{64}$')",
  bm_state_requests_pkey: 'PRIMARY KEY (request_id)',
  bm_state_requests_identity_key:
    'UNIQUE (request_id, request_fingerprint, state_id)',
  bm_state_requests_state_check: 'CHECK (state_id = 1)',
  bm_state_requests_request_id_check:
    "CHECK (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$')",
  bm_state_requests_fingerprint_check:
    "CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')",
  bm_state_requests_status_check:
    "CHECK (status = ANY (ARRAY['pending', 'succeeded', 'conflict']))",
  bm_state_requests_completion_check:
    "CHECK (status = 'pending' AND result_response IS NULL AND completed_at IS NULL OR status = 'succeeded' AND result_response ->> 'ok' = 'true' AND completed_at IS NOT NULL OR status = 'conflict' AND result_response ->> 'ok' = 'false' AND completed_at IS NOT NULL)",
  bm_state_versions_pkey: 'PRIMARY KEY (version_id)',
  bm_state_versions_request_key: 'UNIQUE (request_id)',
  bm_state_versions_state_revision_key:
    'UNIQUE (state_id, replacement_revision)',
  bm_state_versions_request_fk:
    'FOREIGN KEY (request_id, request_fingerprint, state_id) REFERENCES bm_state_requests(request_id, request_fingerprint, state_id)',
  bm_state_versions_state_check: 'CHECK (state_id = 1)',
  bm_state_versions_revision_check:
    `CHECK (base_revision >= 0 AND replacement_revision > base_revision AND replacement_revision <= ${MAX_REVISION})`,
  bm_state_versions_fingerprint_check:
    "CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')",
  bm_state_versions_hash_check:
    "CHECK (base_hash ~ '^[0-9a-f]{64}$' AND replacement_hash ~ '^[0-9a-f]{64}$')",
  bm_state_versions_previous_shape_check:
    "CHECK (base_revision = 0 AND previous_data = 'null' OR base_revision > 0 AND jsonb_typeof(previous_data) = 'object' AND previous_data ? 'orders' AND jsonb_typeof(previous_data -> 'orders') = 'array')",
  bm_state_versions_replacement_shape_check:
    "CHECK (jsonb_typeof(replacement_data) = 'object' AND replacement_data ? 'orders' AND jsonb_typeof(replacement_data -> 'orders') = 'array')",
});

const EXPECTED_TRIGGERS = Object.freeze({
  bm_state: Object.freeze({
    bm_state_history_required: ['BEFORE INSERT OR DELETE OR UPDATE', 'bm_require_state_history'],
    bm_state_no_truncate: ['BEFORE TRUNCATE', 'bm_reject_state_truncate'],
  }),
  bm_state_capability: Object.freeze({}),
  bm_state_requests: Object.freeze({
    bm_state_requests_transition: ['BEFORE DELETE OR UPDATE', 'bm_validate_request_transition'],
    bm_state_requests_result_coupled: ['AFTER INSERT OR UPDATE', 'bm_validate_request_result'],
    bm_state_requests_no_truncate: ['BEFORE TRUNCATE', 'bm_reject_request_truncate'],
  }),
  bm_state_versions: Object.freeze({
    bm_state_versions_no_mutation: ['BEFORE DELETE OR UPDATE', 'bm_reject_history_mutation'],
    bm_state_versions_no_truncate: ['BEFORE TRUNCATE', 'bm_reject_history_truncate'],
  }),
});

const EXPECTED_TRIGGER_DEFINITIONS = Object.freeze({
  bm_state_history_required:
    'CREATE TRIGGER bm_state_history_required BEFORE INSERT OR DELETE OR UPDATE ON bm_state FOR EACH ROW EXECUTE FUNCTION bm_require_state_history()',
  bm_state_no_truncate:
    'CREATE TRIGGER bm_state_no_truncate BEFORE TRUNCATE ON bm_state FOR EACH STATEMENT EXECUTE FUNCTION bm_reject_state_truncate()',
  bm_state_requests_transition:
    'CREATE TRIGGER bm_state_requests_transition BEFORE DELETE OR UPDATE ON bm_state_requests FOR EACH ROW EXECUTE FUNCTION bm_validate_request_transition()',
  bm_state_requests_result_coupled:
    'CREATE TRIGGER bm_state_requests_result_coupled AFTER INSERT OR UPDATE ON bm_state_requests FOR EACH ROW EXECUTE FUNCTION bm_validate_request_result()',
  bm_state_requests_no_truncate:
    'CREATE TRIGGER bm_state_requests_no_truncate BEFORE TRUNCATE ON bm_state_requests FOR EACH STATEMENT EXECUTE FUNCTION bm_reject_request_truncate()',
  bm_state_versions_no_mutation:
    'CREATE TRIGGER bm_state_versions_no_mutation BEFORE DELETE OR UPDATE ON bm_state_versions FOR EACH ROW EXECUTE FUNCTION bm_reject_history_mutation()',
  bm_state_versions_no_truncate:
    'CREATE TRIGGER bm_state_versions_no_truncate BEFORE TRUNCATE ON bm_state_versions FOR EACH STATEMENT EXECUTE FUNCTION bm_reject_history_truncate()',
});

const RUNTIME_FUNCTIONS = Object.freeze([
  'bm_state_apply_change',
  'bm_state_claim_request',
  'bm_state_complete_conflict',
  'bm_state_count_versions',
  'bm_state_read_locked',
  'bm_state_read_revision',
]);

const SECURITY_DEFINER_FUNCTIONS = Object.freeze([
  ...RUNTIME_FUNCTIONS,
  'bm_state_assert_capability',
  'bm_require_state_history',
]);

const TRIGGER_FUNCTIONS = Object.freeze([
  'bm_reject_history_mutation',
  'bm_reject_history_truncate',
  'bm_reject_request_truncate',
  'bm_reject_state_truncate',
  'bm_validate_request_result',
  'bm_validate_request_transition',
]);

const EXPECTED_FUNCTIONS = Object.freeze([
  ...SECURITY_DEFINER_FUNCTIONS,
  ...TRIGGER_FUNCTIONS,
]);

const EXPECTED_FUNCTION_SIGNATURES = Object.freeze({
  bm_state_apply_change: Object.freeze({
    arguments:
      'p_capability text, p_request_id text, p_request_fingerprint text, p_state_id integer, p_expected_revision bigint, p_expected_hash text, p_replacement_revision bigint, p_replacement_hash text, p_replacement_data jsonb, p_replacement_canonical text, p_result jsonb',
    result: 'jsonb',
  }),
  bm_state_assert_capability: Object.freeze({
    arguments: 'p_capability text',
    result: 'void',
  }),
  bm_state_claim_request: Object.freeze({
    arguments:
      'p_capability text, p_request_id text, p_request_fingerprint text, p_state_id integer',
    result: 'SETOF bm_state_requests',
  }),
  bm_state_complete_conflict: Object.freeze({
    arguments:
      'p_capability text, p_request_id text, p_request_fingerprint text, p_state_id integer, p_result jsonb',
    result: 'jsonb',
  }),
  bm_state_count_versions: Object.freeze({
    arguments: 'p_capability text, p_state_id integer',
    result: 'bigint',
  }),
  bm_state_read_locked: Object.freeze({
    arguments: 'p_capability text',
    result: 'TABLE(data jsonb, revision bigint, state_hash text, updated_at bigint)',
  }),
  bm_state_read_revision: Object.freeze({
    arguments:
      'p_capability text, p_state_id integer, p_revision bigint, p_hash text',
    result: 'TABLE(replacement_data jsonb)',
  }),
  bm_require_state_history: Object.freeze({ arguments: '', result: 'trigger' }),
  bm_reject_history_mutation: Object.freeze({ arguments: '', result: 'trigger' }),
  bm_reject_history_truncate: Object.freeze({ arguments: '', result: 'trigger' }),
  bm_reject_request_truncate: Object.freeze({ arguments: '', result: 'trigger' }),
  bm_reject_state_truncate: Object.freeze({ arguments: '', result: 'trigger' }),
  bm_validate_request_result: Object.freeze({ arguments: '', result: 'trigger' }),
  bm_validate_request_transition: Object.freeze({ arguments: '', result: 'trigger' }),
});

const MIGRATION_SQL = Object.freeze([
  `CREATE TABLE IF NOT EXISTS public.bm_state (
    id INTEGER PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at BIGINT NOT NULL,
    revision BIGINT,
    state_hash TEXT
  )`,
  `ALTER TABLE public.bm_state
    ADD COLUMN IF NOT EXISTS revision BIGINT`,
  `ALTER TABLE public.bm_state
    ADD COLUMN IF NOT EXISTS state_hash TEXT`,
  `CREATE TABLE IF NOT EXISTS public.bm_state_requests (
    request_id TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    state_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result_response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT bm_state_requests_pkey PRIMARY KEY (request_id),
    CONSTRAINT bm_state_requests_identity_key
      UNIQUE (request_id, request_fingerprint, state_id),
    CONSTRAINT bm_state_requests_state_check CHECK (state_id = 1),
    CONSTRAINT bm_state_requests_request_id_check
      CHECK (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
    CONSTRAINT bm_state_requests_fingerprint_check
      CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT bm_state_requests_status_check
      CHECK (status IN ('pending', 'succeeded', 'conflict')),
    CONSTRAINT bm_state_requests_completion_check CHECK (
      (status = 'pending' AND result_response IS NULL AND completed_at IS NULL)
      OR
      (status = 'succeeded' AND result_response->>'ok' = 'true' AND completed_at IS NOT NULL)
      OR
      (status = 'conflict' AND result_response->>'ok' = 'false' AND completed_at IS NOT NULL)
    )
  )`,
  `CREATE TABLE IF NOT EXISTS public.bm_state_versions (
    version_id BIGSERIAL NOT NULL,
    state_id INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    base_revision BIGINT NOT NULL,
    replacement_revision BIGINT NOT NULL,
    base_hash TEXT NOT NULL,
    replacement_hash TEXT NOT NULL,
    previous_data JSONB NOT NULL,
    replacement_data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bm_state_versions_pkey PRIMARY KEY (version_id),
    CONSTRAINT bm_state_versions_request_key UNIQUE (request_id),
    CONSTRAINT bm_state_versions_state_revision_key
      UNIQUE (state_id, replacement_revision),
    CONSTRAINT bm_state_versions_request_fk
      FOREIGN KEY (request_id, request_fingerprint, state_id)
      REFERENCES public.bm_state_requests
        (request_id, request_fingerprint, state_id),
    CONSTRAINT bm_state_versions_state_check CHECK (state_id = 1),
    CONSTRAINT bm_state_versions_revision_check CHECK (
      base_revision >= 0
      AND replacement_revision > base_revision
      AND replacement_revision <= ${MAX_REVISION}
    ),
    CONSTRAINT bm_state_versions_fingerprint_check
      CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT bm_state_versions_hash_check CHECK (
      base_hash ~ '^[0-9a-f]{64}$'
      AND replacement_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT bm_state_versions_previous_shape_check CHECK (
      (base_revision = 0 AND previous_data = 'null'::jsonb)
      OR
      (base_revision > 0
        AND jsonb_typeof(previous_data) = 'object'
        AND previous_data ? 'orders'
        AND jsonb_typeof(previous_data->'orders') = 'array')
    ),
    CONSTRAINT bm_state_versions_replacement_shape_check CHECK (
      jsonb_typeof(replacement_data) = 'object'
      AND replacement_data ? 'orders'
      AND jsonb_typeof(replacement_data->'orders') = 'array'
    )
  )`,
  `CREATE TABLE IF NOT EXISTS public.bm_state_capability (
    id INTEGER NOT NULL,
    secret_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bm_state_capability_pkey PRIMARY KEY (id),
    CONSTRAINT bm_state_capability_singleton_check CHECK (id = 1),
    CONSTRAINT bm_state_capability_hash_check
      CHECK (secret_hash ~ '^[0-9a-f]{64}$')
  )`,
  `ALTER TABLE public.bm_state
    ALTER COLUMN revision SET NOT NULL,
    ALTER COLUMN state_hash SET NOT NULL`,
  `DO $migration$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bm_state'::regclass
        AND conname = 'bm_state_pkey'
    ) THEN
      ALTER TABLE public.bm_state
        ADD CONSTRAINT bm_state_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bm_state'::regclass
        AND conname = 'bm_state_singleton_check'
    ) THEN
      ALTER TABLE public.bm_state
        ADD CONSTRAINT bm_state_singleton_check CHECK (id = 1);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bm_state'::regclass
        AND conname = 'bm_state_revision_check'
    ) THEN
      ALTER TABLE public.bm_state
        ADD CONSTRAINT bm_state_revision_check
        CHECK (revision > 0 AND revision <= ${MAX_REVISION});
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bm_state'::regclass
        AND conname = 'bm_state_updated_at_check'
    ) THEN
      ALTER TABLE public.bm_state
        ADD CONSTRAINT bm_state_updated_at_check
        CHECK (updated_at > 0 AND updated_at <= ${MAX_REVISION});
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bm_state'::regclass
        AND conname = 'bm_state_revision_timestamp_check'
    ) THEN
      ALTER TABLE public.bm_state
        ADD CONSTRAINT bm_state_revision_timestamp_check
        CHECK (revision = updated_at);
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bm_state'::regclass
        AND conname = 'bm_state_hash_check'
    ) THEN
      ALTER TABLE public.bm_state
        ADD CONSTRAINT bm_state_hash_check
        CHECK (state_hash ~ '^[0-9a-f]{64}$');
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.bm_state'::regclass
        AND conname = 'bm_state_store_shape_check'
    ) THEN
      ALTER TABLE public.bm_state
        ADD CONSTRAINT bm_state_store_shape_check CHECK (
          jsonb_typeof(data) = 'object'
          AND data ? 'orders'
          AND jsonb_typeof(data->'orders') = 'array'
        );
    END IF;
  END
  $migration$`,
  `CREATE OR REPLACE FUNCTION public.bm_state_assert_capability(p_capability TEXT)
    RETURNS VOID
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      IF p_capability IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.bm_state_capability c
        WHERE c.id = 1
          AND c.secret_hash = encode(sha256(convert_to(p_capability, 'UTF8')), 'hex')
      ) THEN
        RAISE EXCEPTION 'invalid state command capability' USING ERRCODE = '42501';
      END IF;
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_reject_history_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      RAISE EXCEPTION 'bm_state_versions is append-only' USING ERRCODE = '55000';
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_reject_history_truncate()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      RAISE EXCEPTION 'bm_state_versions cannot be truncated' USING ERRCODE = '55000';
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_reject_state_truncate()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      RAISE EXCEPTION 'bm_state cannot be truncated' USING ERRCODE = '55000';
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_reject_request_truncate()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      RAISE EXCEPTION 'bm_state_requests cannot be truncated' USING ERRCODE = '55000';
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_require_state_history()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'bm_state cannot be deleted' USING ERRCODE = '55000';
      END IF;

      IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.bm_state_versions v
          WHERE v.state_id = NEW.id
            AND v.base_revision = 0
            AND v.replacement_revision = NEW.revision
            AND v.base_hash = '${EMPTY_STATE_HASH}'
            AND v.replacement_hash = NEW.state_hash
            AND v.previous_data = 'null'::jsonb
            AND v.replacement_data = NEW.data
        ) THEN
          RAISE EXCEPTION 'bm_state insert requires a matching history row'
            USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END IF;

      IF NEW.id IS DISTINCT FROM OLD.id OR NOT EXISTS (
        SELECT 1 FROM public.bm_state_versions v
        WHERE v.state_id = OLD.id
          AND v.base_revision = OLD.revision
          AND v.replacement_revision = NEW.revision
          AND v.base_hash = OLD.state_hash
          AND v.replacement_hash = NEW.state_hash
          AND v.previous_data = OLD.data
          AND v.replacement_data = NEW.data
      ) THEN
        RAISE EXCEPTION 'bm_state update requires a matching history row'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_validate_request_transition()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'bm_state_requests cannot be deleted' USING ERRCODE = '55000';
      END IF;
      IF OLD.request_id IS DISTINCT FROM NEW.request_id
        OR OLD.request_fingerprint IS DISTINCT FROM NEW.request_fingerprint
        OR OLD.state_id IS DISTINCT FROM NEW.state_id
        OR OLD.created_at IS DISTINCT FROM NEW.created_at
        OR OLD.status <> 'pending'
        OR NEW.status NOT IN ('succeeded', 'conflict')
      THEN
        RAISE EXCEPTION 'invalid bm_state_requests transition' USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_validate_request_result()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      IF NEW.status = 'succeeded' AND NOT EXISTS (
        SELECT 1 FROM public.bm_state_versions v
        WHERE v.request_id = NEW.request_id
          AND v.request_fingerprint = NEW.request_fingerprint
          AND v.state_id = NEW.state_id
      ) THEN
        RAISE EXCEPTION 'successful request requires a matching version'
          USING ERRCODE = '55000';
      END IF;
      IF NEW.status = 'conflict' AND EXISTS (
        SELECT 1 FROM public.bm_state_versions v
        WHERE v.request_id = NEW.request_id
      ) THEN
        RAISE EXCEPTION 'conflict request cannot own a version'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END
    $function$`,
  `DO $migration$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.bm_state_versions'::regclass
        AND tgname = 'bm_state_versions_no_mutation'
    ) THEN
      CREATE TRIGGER bm_state_versions_no_mutation
      BEFORE UPDATE OR DELETE ON public.bm_state_versions
      FOR EACH ROW EXECUTE FUNCTION public.bm_reject_history_mutation();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.bm_state_versions'::regclass
        AND tgname = 'bm_state_versions_no_truncate'
    ) THEN
      CREATE TRIGGER bm_state_versions_no_truncate
      BEFORE TRUNCATE ON public.bm_state_versions
      FOR EACH STATEMENT EXECUTE FUNCTION public.bm_reject_history_truncate();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.bm_state'::regclass
        AND tgname = 'bm_state_history_required'
    ) THEN
      CREATE TRIGGER bm_state_history_required
      BEFORE INSERT OR UPDATE OR DELETE ON public.bm_state
      FOR EACH ROW EXECUTE FUNCTION public.bm_require_state_history();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.bm_state'::regclass
        AND tgname = 'bm_state_no_truncate'
    ) THEN
      CREATE TRIGGER bm_state_no_truncate
      BEFORE TRUNCATE ON public.bm_state
      FOR EACH STATEMENT EXECUTE FUNCTION public.bm_reject_state_truncate();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.bm_state_requests'::regclass
        AND tgname = 'bm_state_requests_transition'
    ) THEN
      CREATE TRIGGER bm_state_requests_transition
      BEFORE UPDATE OR DELETE ON public.bm_state_requests
      FOR EACH ROW EXECUTE FUNCTION public.bm_validate_request_transition();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.bm_state_requests'::regclass
        AND tgname = 'bm_state_requests_result_coupled'
    ) THEN
      CREATE TRIGGER bm_state_requests_result_coupled
      AFTER INSERT OR UPDATE ON public.bm_state_requests
      FOR EACH ROW EXECUTE FUNCTION public.bm_validate_request_result();
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.bm_state_requests'::regclass
        AND tgname = 'bm_state_requests_no_truncate'
    ) THEN
      CREATE TRIGGER bm_state_requests_no_truncate
      BEFORE TRUNCATE ON public.bm_state_requests
      FOR EACH STATEMENT EXECUTE FUNCTION public.bm_reject_request_truncate();
    END IF;
  END
  $migration$`,
  `CREATE OR REPLACE FUNCTION public.bm_state_claim_request(
      p_capability TEXT,
      p_request_id TEXT,
      p_request_fingerprint TEXT,
      p_state_id INTEGER
    )
    RETURNS SETOF public.bm_state_requests
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      PERFORM public.bm_state_assert_capability(p_capability);
      INSERT INTO public.bm_state_requests (
        request_id, request_fingerprint, state_id
      ) VALUES (p_request_id, p_request_fingerprint, p_state_id)
      ON CONFLICT (request_id) DO NOTHING;

      RETURN QUERY
      SELECT r.* FROM public.bm_state_requests r
      WHERE r.request_id = p_request_id
      FOR UPDATE;
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_state_read_locked(p_capability TEXT)
    RETURNS TABLE (data JSONB, revision BIGINT, state_hash TEXT, updated_at BIGINT)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      PERFORM public.bm_state_assert_capability(p_capability);
      RETURN QUERY
        SELECT s.data, s.revision, s.state_hash, s.updated_at
        FROM public.bm_state s
        WHERE s.id = 1
        FOR UPDATE;
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_state_read_revision(
      p_capability TEXT,
      p_state_id INTEGER,
      p_revision BIGINT,
      p_hash TEXT
    )
    RETURNS TABLE (replacement_data JSONB)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      PERFORM public.bm_state_assert_capability(p_capability);
      RETURN QUERY
        SELECT v.replacement_data
        FROM public.bm_state_versions v
        WHERE v.state_id = p_state_id
          AND v.replacement_revision = p_revision
          AND v.replacement_hash = p_hash;
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_state_count_versions(
      p_capability TEXT,
      p_state_id INTEGER
    )
    RETURNS BIGINT
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    BEGIN
      PERFORM public.bm_state_assert_capability(p_capability);
      RETURN (
        SELECT COUNT(*)::bigint
        FROM public.bm_state_versions v
        WHERE v.state_id = p_state_id
      );
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_state_complete_conflict(
      p_capability TEXT,
      p_request_id TEXT,
      p_request_fingerprint TEXT,
      p_state_id INTEGER,
      p_result JSONB
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_count INTEGER;
    BEGIN
      PERFORM public.bm_state_assert_capability(p_capability);
      IF p_result->>'ok' IS DISTINCT FROM 'false' THEN
        RAISE EXCEPTION 'conflict result must have ok=false' USING ERRCODE = '22023';
      END IF;
      UPDATE public.bm_state_requests
      SET status = 'conflict', result_response = p_result, completed_at = clock_timestamp()
      WHERE request_id = p_request_id
        AND request_fingerprint = p_request_fingerprint
        AND state_id = p_state_id
        AND status = 'pending';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'idempotency conflict completion failed' USING ERRCODE = '55000';
      END IF;
      RETURN p_result;
    END
    $function$`,
  `CREATE OR REPLACE FUNCTION public.bm_state_apply_change(
      p_capability TEXT,
      p_request_id TEXT,
      p_request_fingerprint TEXT,
      p_state_id INTEGER,
      p_expected_revision BIGINT,
      p_expected_hash TEXT,
      p_replacement_revision BIGINT,
      p_replacement_hash TEXT,
      p_replacement_data JSONB,
      p_replacement_canonical TEXT,
      p_result JSONB
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $function$
    DECLARE
      v_current public.bm_state%ROWTYPE;
      v_exists BOOLEAN;
      v_count INTEGER;
    BEGIN
      PERFORM public.bm_state_assert_capability(p_capability);
      IF p_result->>'ok' IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'success result must have ok=true' USING ERRCODE = '22023';
      END IF;
      IF p_replacement_canonical IS NULL
        OR p_replacement_canonical::jsonb IS DISTINCT FROM p_replacement_data
        OR encode(sha256(convert_to(p_replacement_canonical, 'UTF8')), 'hex')
          IS DISTINCT FROM p_replacement_hash
      THEN
        RAISE EXCEPTION 'replacement data/hash mismatch' USING ERRCODE = '22023';
      END IF;
      IF p_result IS DISTINCT FROM jsonb_build_object(
        'ok', true,
        'revision', p_replacement_revision,
        'ts', p_replacement_revision,
        'hash', p_replacement_hash,
        'data', p_replacement_data
      ) THEN
        RAISE EXCEPTION 'success result does not describe replacement state'
          USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.bm_state_requests r
        WHERE r.request_id = p_request_id
          AND r.request_fingerprint = p_request_fingerprint
          AND r.state_id = p_state_id
          AND r.status = 'pending'
        FOR UPDATE
      ) THEN
        RAISE EXCEPTION 'missing pending idempotency request' USING ERRCODE = '55000';
      END IF;

      SELECT * INTO v_current
      FROM public.bm_state
      WHERE id = p_state_id
      FOR UPDATE;
      v_exists := FOUND;

      IF v_exists THEN
        IF v_current.revision IS DISTINCT FROM p_expected_revision
          OR v_current.state_hash IS DISTINCT FROM p_expected_hash
        THEN
          RAISE EXCEPTION 'state changed after locked read' USING ERRCODE = '55000';
        END IF;
      ELSIF p_expected_revision <> 0 OR p_expected_hash <> '${EMPTY_STATE_HASH}' THEN
        RAISE EXCEPTION 'initial state precondition mismatch' USING ERRCODE = '55000';
      END IF;

      INSERT INTO public.bm_state_versions (
        state_id,
        request_id,
        request_fingerprint,
        base_revision,
        replacement_revision,
        base_hash,
        replacement_hash,
        previous_data,
        replacement_data
      ) VALUES (
        p_state_id,
        p_request_id,
        p_request_fingerprint,
        p_expected_revision,
        p_replacement_revision,
        p_expected_hash,
        p_replacement_hash,
        CASE WHEN v_exists THEN v_current.data ELSE 'null'::jsonb END,
        p_replacement_data
      );

      IF v_exists THEN
        UPDATE public.bm_state
        SET data = p_replacement_data,
            revision = p_replacement_revision,
            updated_at = p_replacement_revision,
            state_hash = p_replacement_hash
        WHERE id = p_state_id
          AND revision = p_expected_revision
          AND state_hash = p_expected_hash;
      ELSE
        INSERT INTO public.bm_state (id, data, updated_at, revision, state_hash)
        VALUES (
          p_state_id,
          p_replacement_data,
          p_replacement_revision,
          p_replacement_revision,
          p_replacement_hash
        )
        ON CONFLICT (id) DO NOTHING;
      END IF;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'state CAS failed after locked read' USING ERRCODE = '55000';
      END IF;

      UPDATE public.bm_state_requests
      SET status = 'succeeded', result_response = p_result, completed_at = clock_timestamp()
      WHERE request_id = p_request_id
        AND request_fingerprint = p_request_fingerprint
        AND state_id = p_state_id
        AND status = 'pending';
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'idempotency success completion failed' USING ERRCODE = '55000';
      END IF;
      RETURN p_result;
    END
    $function$`,
  `REVOKE ALL ON TABLE public.bm_state,
      public.bm_state_capability,
      public.bm_state_requests,
      public.bm_state_versions
    FROM PUBLIC`,
  `REVOKE ALL ON SEQUENCE public.bm_state_versions_version_id_seq FROM PUBLIC`,
  ...EXPECTED_FUNCTIONS.map(
    (name) => `REVOKE ALL ON FUNCTION public.${name} FROM PUBLIC`
  ),
]);

function createError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function parseRevision(value, label) {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw createError('INVALID_REVISION', `${label} must be a non-negative safe integer`);
  }
  return parsed;
}

function validateHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw createError('INVALID_STATE_HASH', `${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function validateRequestId(requestId) {
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    throw createError('INVALID_REQUEST_ID', 'requestId must be a stable printable identifier');
  }
}

function validateRoleName(roleName) {
  if (typeof roleName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(roleName)) {
    throw createError('INVALID_RUNTIME_ROLE', 'runtimeRole must be a simple PostgreSQL role name');
  }
}

function validateCommandSecret(commandSecret) {
  if (
    typeof commandSecret !== 'string' ||
    Buffer.byteLength(commandSecret, 'utf8') < MIN_COMMAND_SECRET_BYTES
  ) {
    throw createError(
      'INVALID_COMMAND_SECRET',
      `commandSecret must contain at least ${MIN_COMMAND_SECRET_BYTES} UTF-8 bytes`
    );
  }
  return commandSecret;
}

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function requestFingerprint({ baseState, localState, baseRevision, baseHash }) {
  const revision = parseRevision(baseRevision, 'baseRevision');
  const safeBase = cloneJsonValue(baseState);
  const safeLocal = cloneJsonValue(localState);
  assertValidState(safeBase, 'baseState');
  assertValidState(safeLocal, 'localState');
  const computedBaseHash = stateHash(safeBase);
  const submittedBaseHash = validateHash(baseHash, 'baseHash');
  if (computedBaseHash !== submittedBaseHash) {
    throw createError('BASE_HASH_MISMATCH', 'baseHash does not identify baseState');
  }

  return sha256(
    canonicalJsonStringify({
      protocol: 'bm-state-save-v2',
      stateId: STATE_ID,
      baseRevision: revision,
      baseHash: submittedBaseHash,
      baseStateHash: computedBaseHash,
      localStateHash: stateHash(safeLocal),
    })
  );
}

function classifyDefault(value) {
  if (value === null) return 'none';
  if (value === "nextval('bm_state_versions_version_id_seq'::regclass)") return 'sequence';
  if (/^now\(\)$/.test(value)) return 'now';
  if (/^'pending'::text$/.test(value)) return 'pending';
  return value;
}

function setEquals(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function normalizeSqlDefinition(value) {
  return value
    .replace(/"/g, '')
    .replace(/\bpublic\./gi, '')
    .replace(
      /::(?:pg_catalog\.)?(?:bigint|integer|text|jsonb|timestamp with time zone|character varying)(?:\[\])?/gi,
      ''
    )
    .replace(/'(\d+)'/g, '$1')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function schemaDrift(message, details = {}) {
  return createError('SCHEMA_DRIFT', message, details);
}

async function validateColumns(client) {
  const result = await client.query(SQL.READ_SCHEMA_COLUMNS, [TABLES]);
  const actualByTable = new Map(TABLES.map((table) => [table, new Map()]));
  for (const row of result.rows) {
    if (!actualByTable.has(row.table_name)) continue;
    actualByTable.get(row.table_name).set(row.column_name, row);
  }

  for (const table of TABLES) {
    const expected = EXPECTED_COLUMNS[table];
    const actual = actualByTable.get(table);
    if (!setEquals(new Set(Object.keys(expected)), new Set(actual.keys()))) {
      throw schemaDrift(`Unexpected columns on public.${table}`, {
        expectedColumns: Object.keys(expected),
        actualColumns: [...actual.keys()],
      });
    }
    for (const [column, [dataType, nullable, defaultKind]] of Object.entries(expected)) {
      const row = actual.get(column);
      if (
        row.data_type !== dataType ||
        row.is_nullable !== nullable ||
        classifyDefault(row.column_default) !== defaultKind
      ) {
        throw schemaDrift(`Unexpected definition for public.${table}.${column}`, {
          expected: { dataType, nullable, defaultKind },
          actual: row,
        });
      }
    }
  }
}

async function validateRelations(client) {
  const result = await client.query(SQL.READ_SCHEMA_RELATIONS);
  if (
    result.rows.length !== TABLES.length ||
    !setEquals(
      new Set(result.rows.map((row) => row.relation_name)),
      new Set(TABLES)
    )
  ) {
    throw schemaDrift('State safety relation set is incomplete', {
      expectedRelations: TABLES,
      actualRelations: result.rows,
    });
  }
  for (const row of result.rows) {
    if (row.relation_kind !== 'r' || row.relation_owner !== row.migration_user) {
      throw schemaDrift(`Unexpected owner or kind for public.${row.relation_name}`, {
        actual: row,
      });
    }
  }

  const sequences = await client.query(SQL.READ_SCHEMA_SEQUENCE);
  if (
    sequences.rows.length !== 1 ||
    sequences.rows[0].sequence_name !== 'bm_state_versions_version_id_seq' ||
    sequences.rows[0].sequence_owner !== sequences.rows[0].migration_user
  ) {
    throw schemaDrift('Unexpected state version sequence', {
      actualSequences: sequences.rows,
    });
  }
}

async function validateConstraints(client) {
  const result = await client.query(SQL.READ_SCHEMA_CONSTRAINTS, [TABLES]);
  const actualByTable = new Map(TABLES.map((table) => [table, new Map()]));
  for (const row of result.rows) {
    if (actualByTable.has(row.table_name)) {
      actualByTable.get(row.table_name).set(row.constraint_name, row);
    }
  }

  for (const table of TABLES) {
    const expected = EXPECTED_CONSTRAINTS[table];
    const actual = actualByTable.get(table);
    if (!setEquals(new Set(Object.keys(expected)), new Set(actual.keys()))) {
      throw schemaDrift(`Unexpected constraints on public.${table}`, {
        expectedConstraints: Object.keys(expected),
        actualConstraints: [...actual.keys()],
      });
    }
    for (const [constraint, type] of Object.entries(expected)) {
      const row = actual.get(constraint);
      if (row.constraint_type !== type) {
        throw schemaDrift(`Unexpected type for constraint ${constraint}`, {
          expectedType: type,
          actual: row,
        });
      }
      const normalizedDefinition = normalizeSqlDefinition(row.definition);
      const expectedDefinition = normalizeSqlDefinition(
        EXPECTED_CONSTRAINT_DEFINITIONS[constraint]
      );
      if (normalizedDefinition !== expectedDefinition) {
        throw schemaDrift(`Unexpected definition for constraint ${constraint}`, {
          expectedDefinition: EXPECTED_CONSTRAINT_DEFINITIONS[constraint],
          actual: row,
        });
      }
    }
  }
}

async function validateTriggers(client) {
  const result = await client.query(SQL.READ_SCHEMA_TRIGGERS, [TABLES]);
  const actualByTable = new Map(TABLES.map((table) => [table, new Map()]));
  for (const row of result.rows) {
    if (actualByTable.has(row.table_name)) {
      actualByTable.get(row.table_name).set(row.trigger_name, row);
    }
  }

  for (const table of TABLES) {
    const expected = EXPECTED_TRIGGERS[table];
    const actual = actualByTable.get(table);
    if (!setEquals(new Set(Object.keys(expected)), new Set(actual.keys()))) {
      throw schemaDrift(`Unexpected triggers on public.${table}`, {
        expectedTriggers: Object.keys(expected),
        actualTriggers: [...actual.keys()],
      });
    }
    for (const trigger of Object.keys(expected)) {
      const row = actual.get(trigger);
      const normalizedDefinition = normalizeSqlDefinition(row.definition);
      if (
        row.enabled !== 'O' ||
        normalizedDefinition !== normalizeSqlDefinition(EXPECTED_TRIGGER_DEFINITIONS[trigger])
      ) {
        throw schemaDrift(`Unexpected definition for trigger ${trigger}`, { actual: row });
      }
    }
  }
}

async function validateFunctions(client, runtimeRole) {
  const result = await client.query(SQL.READ_SCHEMA_FUNCTIONS, [EXPECTED_FUNCTIONS]);
  const names = new Set(result.rows.map((row) => row.function_name));
  if (
    result.rows.length !== EXPECTED_FUNCTIONS.length ||
    !setEquals(names, new Set(EXPECTED_FUNCTIONS))
  ) {
    throw schemaDrift('State safety function set is incomplete or ambiguous', {
      expectedFunctions: EXPECTED_FUNCTIONS,
      actualFunctions: result.rows,
    });
  }

  for (const row of result.rows) {
    const signature = EXPECTED_FUNCTION_SIGNATURES[row.function_name];
    const shouldBeDefiner = SECURITY_DEFINER_FUNCTIONS.includes(row.function_name);
    const expectedGrantees = runtimeRole && RUNTIME_FUNCTIONS.includes(row.function_name)
      ? [runtimeRole]
      : [];
    if (
      row.identity_arguments !== signature.arguments ||
      row.result_type !== signature.result ||
      row.language_name !== 'plpgsql' ||
      row.function_owner !== row.migration_user ||
      Boolean(row.security_definer) !== shouldBeDefiner ||
      !setEquals(
        new Set(row.configuration || []),
        new Set(shouldBeDefiner ? ['search_path=pg_catalog, public'] : [])
      ) ||
      !setEquals(new Set(row.execute_grantees || []), new Set(expectedGrantees))
    ) {
      throw schemaDrift(`Unexpected definition for function ${row.function_name}`, {
        expected: {
          ...signature,
          languageName: 'plpgsql',
          owner: row.migration_user,
          securityDefiner: shouldBeDefiner,
          executeGrantees: expectedGrantees,
        },
        actual: row,
      });
    }
    if (shouldBeDefiner) {
      const configuration = row.configuration || [];
      if (!configuration.some((entry) => entry === 'search_path=pg_catalog, public')) {
        throw schemaDrift(`Unsafe search_path for function ${row.function_name}`, {
          actual: row,
        });
      }
    }
  }

  if (runtimeRole) {
    const privileges = await client.query(SQL.READ_RUNTIME_FUNCTION_PRIVILEGES, [
      runtimeRole,
      EXPECTED_FUNCTIONS,
    ]);
    if (privileges.rows.length !== EXPECTED_FUNCTIONS.length) {
      throw schemaDrift('Runtime function privilege validation is incomplete');
    }
    for (const row of privileges.rows) {
      if (Boolean(row.can_execute) !== RUNTIME_FUNCTIONS.includes(row.function_name)) {
        throw schemaDrift('Runtime role has an unsafe function privilege', {
          runtimeRole,
          function: row,
        });
      }
    }
  }
}

async function validateSchema(client, { runtimeRole } = {}) {
  await validateRelations(client);
  await validateColumns(client);
  await validateConstraints(client);
  await validateTriggers(client);
  await validateFunctions(client, runtimeRole);
}

async function validateDataIntegrity(client) {
  const currentResult = await client.query(SQL.READ_MIGRATION_STATE_ROWS);
  if (currentResult.rows.length > 1) {
    throw schemaDrift('Singleton state contains multiple rows');
  }
  const current = currentResult.rows[0] || null;
  const versions = (await client.query(SQL.READ_INTEGRITY_VERSIONS, [STATE_ID])).rows;
  let previous = null;

  for (const row of versions) {
    const baseRevision = parseRevision(row.base_revision, 'history base revision');
    const replacementRevision = parseRevision(
      row.replacement_revision,
      'history replacement revision'
    );
    const baseHash = validateHash(row.base_hash, 'history base hash');
    const replacementHash = validateHash(row.replacement_hash, 'history replacement hash');
    const replacementData = cloneJsonValue(row.replacement_data);
    assertValidState(replacementData, 'history replacement state');
    if (stateHash(replacementData) !== replacementHash) {
      throw schemaDrift('History replacement hash disagrees with replacement data');
    }

    if (previous === null) {
      if (
        baseRevision !== 0 ||
        baseHash !== EMPTY_STATE_HASH ||
        row.previous_data !== null
      ) {
        throw schemaDrift('History does not begin at the canonical empty state');
      }
    } else {
      const previousData = cloneJsonValue(row.previous_data);
      assertValidState(previousData, 'history previous state');
      if (
        baseRevision !== previous.revision ||
        baseHash !== previous.hash ||
        canonicalJsonStringify(previousData) !== canonicalJsonStringify(previous.data)
      ) {
        throw schemaDrift('History chain contains a discontinuity');
      }
    }

    const expectedResponse = {
      ok: true,
      revision: replacementRevision,
      ts: replacementRevision,
      hash: replacementHash,
      data: replacementData,
    };
    if (
      row.request_status !== 'succeeded' ||
      canonicalJsonStringify(cloneJsonValue(row.result_response)) !==
        canonicalJsonStringify(expectedResponse)
    ) {
      throw schemaDrift('History request result does not describe its replacement state');
    }
    previous = {
      revision: replacementRevision,
      hash: replacementHash,
      data: replacementData,
    };
  }

  if ((current === null) !== (previous === null)) {
    throw schemaDrift('Current state and history presence disagree');
  }
  if (current && previous) {
    const currentRevision = parseRevision(current.revision, 'current revision');
    const currentHash = validateHash(current.state_hash, 'current state hash');
    const currentData = cloneJsonValue(current.data);
    assertValidState(currentData, 'current state');
    if (
      currentRevision !== parseRevision(current.updated_at, 'current timestamp') ||
      currentRevision !== previous.revision ||
      currentHash !== previous.hash ||
      stateHash(currentData) !== currentHash ||
      canonicalJsonStringify(currentData) !== canonicalJsonStringify(previous.data)
    ) {
      throw schemaDrift('Current state does not match the final history version');
    }
  }

  const requests = (await client.query(SQL.READ_INTEGRITY_REQUESTS)).rows;
  for (const row of requests) {
    const versionCount = parseRevision(row.version_count, 'request version count');
    if (
      row.status === 'pending' ||
      (row.status === 'succeeded' && versionCount !== 1) ||
      (row.status === 'conflict' && versionCount !== 0)
    ) {
      throw schemaDrift('Request lifecycle is inconsistent with version history', {
        requestId: row.request_id,
        status: row.status,
        versionCount,
      });
    }
    try {
      parseStoredResult(row.result_response);
    } catch (cause) {
      throw schemaDrift('Persisted request response is malformed', {
        requestId: row.request_id,
        cause,
      });
    }
  }
}

function hasOneRow(result) {
  return Boolean(result && Array.isArray(result.rows) && result.rows.length === 1);
}

function getOneRow(result, message) {
  if (!hasOneRow(result)) throw createError('STATE_INTEGRITY_ERROR', message);
  return result.rows[0];
}

async function rollbackTransaction(client, transaction, originalError) {
  if (!transaction.began) return;
  try {
    await client.query('ROLLBACK');
    transaction.began = false;
  } catch (rollbackError) {
    transaction.destroyError = rollbackError;
    originalError.rollbackError = rollbackError;
  }
}

function releaseClient(client, destroyError) {
  if (typeof client.release === 'function') client.release(destroyError || undefined);
}

function hasExactKeys(value, expectedKeys) {
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    setEquals(new Set(Object.keys(value)), new Set(expectedKeys));
}

function parseStoredResult(value) {
  try {
    const result = cloneJsonValue(value);
    if (result.ok === true) {
      if (!hasExactKeys(result, ['ok', 'revision', 'ts', 'hash', 'data'])) {
        throw new Error('unexpected success keys');
      }
      const revision = parseRevision(result.revision, 'persisted success revision');
      if (revision === 0 || parseRevision(result.ts, 'persisted success timestamp') !== revision) {
        throw new Error('success revision and timestamp disagree');
      }
      const hash = validateHash(result.hash, 'persisted success hash');
      assertValidState(result.data, 'persisted success state');
      if (stateHash(result.data) !== hash) throw new Error('success hash disagrees with data');
      return result;
    }

    if (result.ok !== false || !hasExactKeys(result, ['ok', 'conflict'])) {
      throw new Error('unexpected result envelope');
    }
    const conflict = result.conflict;
    if (!conflict || typeof conflict !== 'object' || Array.isArray(conflict)) {
      throw new Error('missing conflict body');
    }
    if (conflict.kind === 'base-version-mismatch') {
      if (!hasExactKeys(conflict, [
        'kind',
        'expectedBaseRevision',
        'expectedBaseHash',
        'actualRevision',
        'actualHash',
        'remoteState',
      ])) {
        throw new Error('unexpected base mismatch keys');
      }
      parseRevision(conflict.expectedBaseRevision, 'expected base revision');
      validateHash(conflict.expectedBaseHash, 'expected base hash');
    } else if (conflict.kind === 'merge-conflict') {
      if (!hasExactKeys(conflict, [
        'kind',
        'conflicts',
        'actualRevision',
        'actualHash',
        'remoteState',
      ]) || !Array.isArray(conflict.conflicts) || conflict.conflicts.length === 0) {
        throw new Error('unexpected merge conflict keys');
      }
    } else {
      throw new Error('unknown persisted conflict kind');
    }

    const actualRevision = parseRevision(conflict.actualRevision, 'conflict actual revision');
    const actualHash = validateHash(conflict.actualHash, 'conflict actual hash');
    assertValidState(conflict.remoteState, 'conflict remote state');
    if (
      stateHash(conflict.remoteState) !== actualHash ||
      (actualRevision === 0 && actualHash !== EMPTY_STATE_HASH)
    ) {
      throw new Error('conflict remote state is not bound to its version');
    }
    return result;
  } catch (cause) {
    if (cause && cause.code === 'STATE_INTEGRITY_ERROR') throw cause;
    throw createError(
      'STATE_INTEGRITY_ERROR',
      'Persisted idempotency result is malformed',
      { cause }
    );
  }
}

function parseCurrentStateRow(row) {
  if (!row) {
    return {
      revision: 0,
      ts: 0,
      hash: EMPTY_STATE_HASH,
      data: cloneJsonValue(EMPTY_STORE),
    };
  }

  const data = cloneJsonValue(row.data);
  assertValidState(data, 'persisted state');
  const revision = parseRevision(row.revision, 'persisted revision');
  const updatedAt = parseRevision(row.updated_at, 'persisted updated_at');
  const hash = validateHash(row.state_hash, 'persisted state hash');
  if (revision === 0 || revision !== updatedAt || stateHash(data) !== hash) {
    throw createError('STATE_INTEGRITY_ERROR', 'Persisted state revision or hash is inconsistent');
  }
  return { revision, ts: revision, hash, data };
}

function createStateRepository({
  pool,
  migrationPool = pool,
  runtimeRole,
  commandSecret,
  clock = Date.now,
} = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('An injected pg-like runtime pool is required');
  }
  if (!migrationPool || typeof migrationPool.connect !== 'function') {
    throw new TypeError('An injected pg-like migration pool is required');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof runtimeRole !== 'undefined') validateRoleName(runtimeRole);
  const safeCommandSecret = validateCommandSecret(commandSecret);
  const safeCommandSecretHash = sha256(safeCommandSecret);

  async function initialize() {
    const client = await migrationPool.connect();
    const transaction = { began: false, destroyError: null };
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      transaction.began = true;
      await client.query(SQL.ACQUIRE_MIGRATION_LOCK, [MIGRATION_LOCK_KEY]);

      for (const statement of MIGRATION_SQL.slice(0, 6)) await client.query(statement);

      await client.query(SQL.STORE_COMMAND_SECRET_HASH, [STATE_ID, safeCommandSecretHash]);
      const storedSecret = getOneRow(
        await client.query(SQL.READ_COMMAND_SECRET_HASH, [STATE_ID]),
        'State command capability is missing'
      );
      if (storedSecret.secret_hash !== safeCommandSecretHash) {
        throw schemaDrift('Configured state command capability does not match the database');
      }

      const stateRows = await client.query(SQL.READ_MIGRATION_STATE_ROWS);
      if (stateRows.rows.length > 1 || (stateRows.rows[0] && Number(stateRows.rows[0].id) !== STATE_ID)) {
        throw schemaDrift('public.bm_state contains a non-singleton row');
      }
      for (const row of stateRows.rows) {
        let revision;
        try {
          revision = parseRevision(row.updated_at, 'legacy updated_at');
          if (revision === 0) throw new Error('revision zero is reserved for absent state');
          assertValidState(row.data, 'legacy state');
        } catch (error) {
          throw schemaDrift('Existing public.bm_state data is incompatible', { cause: error });
        }
        const expectedHash = stateHash(row.data);
        if (row.revision !== null && parseRevision(row.revision, 'revision') !== revision) {
          throw schemaDrift('Existing state revision disagrees with updated_at');
        }
        if (row.state_hash !== null && row.state_hash !== expectedHash) {
          throw schemaDrift('Existing state hash disagrees with data');
        }
        if (row.revision === null || row.state_hash === null) {
          await client.query(SQL.BACKFILL_STATE_ROW, [STATE_ID, revision, expectedHash]);
        }
      }

      const legacyRow = stateRows.rows[0] || null;
      const versionCountRow = getOneRow(
        await client.query(SQL.COUNT_MIGRATION_VERSIONS, [STATE_ID]),
        'History count failed during migration'
      );
      const versionCount = parseRevision(versionCountRow.count, 'migration history count');
      if (!legacyRow && versionCount !== 0) {
        throw schemaDrift('History exists without a current singleton state');
      }
      if (legacyRow && versionCount === 0) {
        const revision = parseRevision(legacyRow.updated_at, 'legacy snapshot revision');
        const hash = stateHash(legacyRow.data);
        const requestId = `legacy-snapshot-${revision}-${hash.slice(0, 16)}`;
        const fingerprint = sha256(canonicalJsonStringify({
          protocol: 'bm-state-legacy-snapshot-v1',
          stateId: STATE_ID,
          revision,
          hash,
        }));
        const response = {
          ok: true,
          revision,
          ts: revision,
          hash,
          data: legacyRow.data,
        };
        await client.query(SQL.INSERT_LEGACY_REQUEST, [requestId, fingerprint, STATE_ID]);
        await client.query(SQL.INSERT_LEGACY_VERSION, [
          STATE_ID,
          requestId,
          fingerprint,
          revision,
          EMPTY_STATE_HASH,
          hash,
          JSON.stringify(legacyRow.data),
        ]);
        const completed = await client.query(SQL.COMPLETE_LEGACY_REQUEST, [
          requestId,
          fingerprint,
          STATE_ID,
          JSON.stringify(response),
        ]);
        if (completed.rowCount !== 1) {
          throw schemaDrift('Legacy snapshot request completion failed');
        }
      }

      for (const statement of MIGRATION_SQL.slice(6)) await client.query(statement);

      if (runtimeRole) {
        const quotedRole = quoteIdentifier(runtimeRole);
        await client.query(
          `REVOKE ALL PRIVILEGES ON TABLE public.bm_state,
             public.bm_state_capability,
             public.bm_state_requests,
             public.bm_state_versions
           FROM ${quotedRole}`
        );
        await client.query(
          `REVOKE ALL PRIVILEGES ON SEQUENCE public.bm_state_versions_version_id_seq
           FROM ${quotedRole}`
        );
        await client.query(`REVOKE CREATE ON SCHEMA public FROM ${quotedRole}`);
        for (const functionName of EXPECTED_FUNCTIONS) {
          await client.query(
            `REVOKE ALL PRIVILEGES ON FUNCTION public.${functionName} FROM ${quotedRole}`
          );
        }
        for (const functionName of RUNTIME_FUNCTIONS) {
          await client.query(
            `GRANT EXECUTE ON FUNCTION public.${functionName} TO ${quotedRole}`
          );
        }
        const privileges = getOneRow(
          await client.query(SQL.READ_RUNTIME_PRIVILEGES, [runtimeRole]),
          'Runtime privilege validation failed'
        );
        if (Object.values(privileges).some(Boolean)) {
          throw schemaDrift('Runtime role retains unsafe direct state privileges', {
            runtimeRole,
            privileges,
          });
        }
      }

      await validateSchema(client, { runtimeRole });
      await validateDataIntegrity(client);
      await client.query('COMMIT');
      transaction.began = false;
    } catch (error) {
      await rollbackTransaction(client, transaction, error);
      throw error;
    } finally {
      releaseClient(client, transaction.destroyError);
    }
  }

  async function saveState({
    baseState,
    localState,
    baseRevision,
    baseHash,
    requestId,
  } = {}) {
    const revision = parseRevision(baseRevision, 'baseRevision');
    validateRequestId(requestId);
    const safeBase = cloneJsonValue(baseState);
    const safeLocal = cloneJsonValue(localState);
    assertValidState(safeBase, 'baseState');
    assertValidState(safeLocal, 'localState');
    const submittedBaseHash = validateHash(baseHash, 'baseHash');
    const computedBaseHash = stateHash(safeBase);
    if (submittedBaseHash !== computedBaseHash) {
      throw createError('BASE_HASH_MISMATCH', 'baseHash does not identify baseState');
    }
    if (revision === 0 && computedBaseHash !== EMPTY_STATE_HASH) {
      throw createError('BASE_HASH_MISMATCH', 'revision zero must identify the empty store');
    }

    const fingerprint = requestFingerprint({
      baseState: safeBase,
      localState: safeLocal,
      baseRevision: revision,
      baseHash: submittedBaseHash,
    });
    const client = await pool.connect();
    const transaction = { began: false, destroyError: null };

    async function completeConflict(conflict) {
      const response = { ok: false, conflict };
      const completed = await client.query(SQL.COMPLETE_CONFLICT, [
        safeCommandSecret,
        requestId,
        fingerprint,
        STATE_ID,
        JSON.stringify(response),
      ]);
      const row = getOneRow(completed, 'Conflict result persistence failed');
      return parseStoredResult(row.result_response);
    }

    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      transaction.began = true;
      await client.query(SQL.ACQUIRE_STATE_LOCK, [STATE_LOCK_KEY]);

      const claimed = getOneRow(
        await client.query(SQL.CLAIM_REQUEST, [
          safeCommandSecret,
          requestId,
          fingerprint,
          STATE_ID,
        ]),
        'Idempotency claim failed'
      );
      if (claimed.request_fingerprint !== fingerprint || Number(claimed.state_id) !== STATE_ID) {
        await client.query('COMMIT');
        transaction.began = false;
        return {
          ok: false,
          conflict: { kind: 'idempotency-mismatch', requestId },
          idempotent: false,
        };
      }
      if (claimed.status !== 'pending') {
        const replay = parseStoredResult(claimed.result_response);
        await client.query('COMMIT');
        transaction.began = false;
        return { ...replay, idempotent: true };
      }

      const currentResult = await client.query(SQL.READ_STATE_FOR_UPDATE, [safeCommandSecret]);
      if (currentResult.rows.length > 1) {
        throw createError('STATE_INTEGRITY_ERROR', 'Singleton state query returned multiple rows');
      }
      const current = currentResult.rows[0] || null;
      let actualState = cloneJsonValue(EMPTY_STORE);
      let actualRevision = 0;
      let actualHash = EMPTY_STATE_HASH;

      if (current) {
        const parsedCurrent = parseCurrentStateRow(current);
        actualState = parsedCurrent.data;
        actualRevision = parsedCurrent.revision;
        actualHash = parsedCurrent.hash;
      } else {
        const countRow = getOneRow(
          await client.query(SQL.COUNT_VERSIONS, [safeCommandSecret, STATE_ID]),
          'History count failed'
        );
        if (parseRevision(countRow.count, 'history count') !== 0) {
          throw createError('STATE_INTEGRITY_ERROR', 'State is absent while history exists');
        }
      }

      let baseIsBound = revision === 0 && submittedBaseHash === EMPTY_STATE_HASH;
      if (revision === actualRevision && submittedBaseHash === actualHash) {
        baseIsBound = true;
      } else if (!baseIsBound) {
        const historical = await client.query(SQL.READ_HISTORICAL_STATE, [
          safeCommandSecret,
          STATE_ID,
          revision,
          submittedBaseHash,
        ]);
        if (historical.rows.length === 1) {
          const historicalState = cloneJsonValue(historical.rows[0].replacement_data);
          assertValidState(historicalState, 'historical state');
          baseIsBound = stateHash(historicalState) === submittedBaseHash;
        } else if (historical.rows.length > 1) {
          throw createError('STATE_INTEGRITY_ERROR', 'Historical revision is not unique');
        }
      }

      if (!baseIsBound) {
        const result = await completeConflict({
          kind: 'base-version-mismatch',
          expectedBaseRevision: revision,
          expectedBaseHash: submittedBaseHash,
          actualRevision,
          actualHash,
          remoteState: actualState,
        });
        await client.query('COMMIT');
        transaction.began = false;
        return { ...result, idempotent: false };
      }

      const merge = threeWayMergeState(safeBase, safeLocal, actualState);
      if (!merge.ok) {
        const result = await completeConflict({
          kind: 'merge-conflict',
          conflicts: merge.conflicts,
          actualRevision,
          actualHash,
          remoteState: actualState,
        });
        await client.query('COMMIT');
        transaction.began = false;
        return { ...result, idempotent: false };
      }

      const clockValue = clock();
      if (typeof clockValue !== 'number' || !Number.isFinite(clockValue)) {
        throw createError('INVALID_REVISION', 'clock result must be a finite number');
      }
      const now = parseRevision(Math.trunc(clockValue), 'clock result');
      const nextRevision = Math.max(now, actualRevision + 1, 1);
      if (!Number.isSafeInteger(nextRevision) || nextRevision > MAX_REVISION) {
        throw createError('INVALID_REVISION', 'next revision exceeds the safe integer range');
      }

      const mergedState = cloneJsonValue(merge.merged);
      const replacementHash = stateHash(mergedState);
      const response = {
        ok: true,
        revision: nextRevision,
        ts: nextRevision,
        hash: replacementHash,
        data: mergedState,
      };
      const applied = await client.query(SQL.APPLY_STATE_CHANGE, [
        safeCommandSecret,
        requestId,
        fingerprint,
        STATE_ID,
        actualRevision,
        actualHash,
        nextRevision,
        replacementHash,
        JSON.stringify(mergedState),
        canonicalJsonStringify(mergedState),
        JSON.stringify(response),
      ]);
      const row = getOneRow(applied, 'State change function returned no result');
      const stored = parseStoredResult(row.result_response);

      await client.query('COMMIT');
      transaction.began = false;
      return { ...stored, idempotent: false };
    } catch (error) {
      await rollbackTransaction(client, transaction, error);
      throw error;
    } finally {
      releaseClient(client, transaction.destroyError);
    }
  }

  async function loadState() {
    const client = await pool.connect();
    const transaction = { began: false, destroyError: null };
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      transaction.began = true;
      await client.query(SQL.ACQUIRE_STATE_LOCK, [STATE_LOCK_KEY]);
      const currentResult = await client.query(SQL.READ_STATE_FOR_UPDATE, [safeCommandSecret]);
      if (currentResult.rows.length > 1) {
        throw createError('STATE_INTEGRITY_ERROR', 'Singleton state query returned multiple rows');
      }
      if (currentResult.rows.length === 0) {
        const countRow = getOneRow(
          await client.query(SQL.COUNT_VERSIONS, [safeCommandSecret, STATE_ID]),
          'History count failed'
        );
        if (parseRevision(countRow.count, 'history count') !== 0) {
          throw createError('STATE_INTEGRITY_ERROR', 'State is absent while history exists');
        }
      }
      const state = parseCurrentStateRow(currentResult.rows[0] || null);
      await client.query('COMMIT');
      transaction.began = false;
      return state;
    } catch (error) {
      await rollbackTransaction(client, transaction, error);
      throw error;
    } finally {
      releaseClient(client, transaction.destroyError);
    }
  }

  return Object.freeze({ initialize, loadState, saveState });
}

module.exports = {
  EMPTY_STATE_HASH,
  EMPTY_STORE,
  MAX_REVISION,
  MIGRATION_SQL,
  SCHEMA_SQL: MIGRATION_SQL,
  SQL,
  createStateRepository,
  requestFingerprint,
  stateHash,
  validateSchema,
};

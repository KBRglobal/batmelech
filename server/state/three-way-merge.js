'use strict';

// Equality-first three-way merge follows the MIT Trimerge pattern, specialized
// for Bat Melech's full legacy store and stable string order identifiers.

const MISSING = Symbol('missing');
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ORDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_JSON_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 100_000,
  maxBytes: 8 * 1024 * 1024,
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function propertyPath(parent, key) {
  return !BLOCKED_KEYS.has(key) && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function orderPath(parent, id) {
  return `${parent}[id=${JSON.stringify(id)}]`;
}

function addIssue(issues, source, path, kind, details = {}) {
  issues.push({ source, path, kind, ...details });
}

function normalizeLimits(limits = DEFAULT_JSON_LIMITS) {
  const normalized = {
    maxDepth: limits.maxDepth ?? DEFAULT_JSON_LIMITS.maxDepth,
    maxNodes: limits.maxNodes ?? DEFAULT_JSON_LIMITS.maxNodes,
    maxBytes: limits.maxBytes ?? DEFAULT_JSON_LIMITS.maxBytes,
  };

  for (const [name, value] of Object.entries(normalized)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`${name} must be a positive safe integer`);
    }
  }
  return normalized;
}

function inspectJsonValue(
  value,
  source = 'value',
  rootPath = '$',
  limits = DEFAULT_JSON_LIMITS
) {
  const normalizedLimits = normalizeLimits(limits);
  const issues = [];
  const ancestors = new WeakSet();
  const stack = [{ type: 'enter', value, path: rootPath, depth: 0 }];
  let nodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame.type === 'exit') {
      ancestors.delete(frame.value);
      continue;
    }

    const current = frame.value;
    nodes += 1;
    if (nodes > normalizedLimits.maxNodes) {
      addIssue(issues, source, frame.path, 'node-limit-exceeded', {
        limit: normalizedLimits.maxNodes,
      });
      break;
    }

    if (frame.depth > normalizedLimits.maxDepth) {
      addIssue(issues, source, frame.path, 'depth-limit-exceeded', {
        limit: normalizedLimits.maxDepth,
      });
      continue;
    }

    if (
      current === null ||
      typeof current === 'string' ||
      typeof current === 'boolean'
    ) {
      continue;
    }

    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        addIssue(issues, source, frame.path, 'non-finite-number');
      }
      continue;
    }

    if (typeof current !== 'object') {
      addIssue(issues, source, frame.path, 'non-json-value');
      continue;
    }

    if (ancestors.has(current)) {
      addIssue(issues, source, frame.path, 'cyclic-value');
      continue;
    }

    if (!Array.isArray(current) && !isPlainObject(current)) {
      addIssue(issues, source, frame.path, 'non-plain-object');
      continue;
    }

    ancestors.add(current);
    stack.push({ type: 'exit', value: current });

    if (Array.isArray(current)) {
      if (current.length > normalizedLimits.maxNodes) {
        addIssue(issues, source, frame.path, 'array-length-limit-exceeded', {
          limit: normalizedLimits.maxNodes,
          actual: current.length,
        });
        continue;
      }

      const ownKeys = Reflect.ownKeys(current);
      for (const key of ownKeys) {
        if (key === 'length') continue;
        const isDenseIndex =
          typeof key === 'string' &&
          /^(0|[1-9]\d*)$/.test(key) &&
          Number(key) < current.length &&
          String(Number(key)) === key;
        if (!isDenseIndex) {
          addIssue(issues, source, propertyPath(frame.path, String(key)), 'non-json-array-property');
        }
      }

      for (let index = current.length - 1; index >= 0; index -= 1) {
        const childPath = `${frame.path}[${index}]`;
        if (!hasOwn(current, index)) {
          addIssue(issues, source, childPath, 'sparse-array');
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
        if (!descriptor || !hasOwn(descriptor, 'value')) {
          addIssue(issues, source, childPath, 'accessor-property');
          continue;
        }
        if (!descriptor.enumerable) {
          addIssue(issues, source, childPath, 'non-enumerable-property');
          continue;
        }
        stack.push({
          type: 'enter',
          value: descriptor.value,
          path: childPath,
          depth: frame.depth + 1,
        });
      }
      continue;
    }

    const keys = Reflect.ownKeys(current);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (typeof key !== 'string') {
        addIssue(issues, source, frame.path, 'symbol-key');
        continue;
      }

      const childPath = propertyPath(frame.path, key);
      if (BLOCKED_KEYS.has(key)) {
        addIssue(issues, source, childPath, 'unsafe-key');
        continue;
      }

      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !descriptor.enumerable) {
        addIssue(issues, source, childPath, 'non-enumerable-property');
        continue;
      }
      if (!hasOwn(descriptor, 'value')) {
        addIssue(issues, source, childPath, 'accessor-property');
        continue;
      }
      stack.push({
        type: 'enter',
        value: descriptor.value,
        path: childPath,
        depth: frame.depth + 1,
      });
    }
  }

  if (issues.length === 0) {
    const serialized = JSON.stringify(value);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > normalizedLimits.maxBytes) {
      addIssue(issues, source, rootPath, 'byte-limit-exceeded', {
        limit: normalizedLimits.maxBytes,
        actual: bytes,
      });
    }
  }

  return issues;
}

function assertSafeJson(value, label = 'value', limits = DEFAULT_JSON_LIMITS) {
  const issues = inspectJsonValue(value, label, '$', limits);
  if (issues.length === 0) return;

  const error = new TypeError(`${label} is not safe JSON at ${issues[0].path}`);
  error.code = 'INVALID_JSON_STATE';
  error.issues = issues;
  throw error;
}

function cloneJsonValue(value) {
  assertSafeJson(value);

  function clone(current) {
    if (current === null || typeof current !== 'object') return current;
    if (Array.isArray(current)) return current.map(clone);

    const result = {};
    for (const key of Object.keys(current)) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: clone(current[key]),
      });
    }
    return result;
  }

  return clone(value);
}

function canonicalJsonStringify(value) {
  assertSafeJson(value);

  function encode(current) {
    if (current === null || typeof current !== 'object') return JSON.stringify(current);
    if (Array.isArray(current)) return `[${current.map(encode).join(',')}]`;

    return `{${Object.keys(current)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encode(current[key])}`)
      .join(',')}}`;
  }

  return encode(value);
}

function deepEqual(left, right) {
  if (left === MISSING || right === MISSING) return left === right;
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (typeof left !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;

  if (Array.isArray(left)) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) return false;
    }
    return true;
  }

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    if (key !== rightKeys[index] || !deepEqual(left[key], right[key])) return false;
  }

  return true;
}

function cloneMerged(value) {
  if (value === MISSING) return MISSING;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneMerged);

  const result = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: cloneMerged(value[key]),
    });
  }
  return result;
}

function orderedUnionKeys(...records) {
  const seen = new Set();
  const result = [];

  for (const record of records) {
    if (record === MISSING) continue;
    for (const key of Object.keys(record)) {
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(key);
    }
  }

  return result;
}

function conflict(conflicts, path, kind, details = {}) {
  conflicts.push({ path, kind, ...details });
  return MISSING;
}

function mergeRecord(base, local, remote, path, conflicts) {
  const result = {};
  const keys = orderedUnionKeys(base, local, remote);

  for (const key of keys) {
    const child = mergeNode(
      base !== MISSING && hasOwn(base, key) ? base[key] : MISSING,
      local !== MISSING && hasOwn(local, key) ? local[key] : MISSING,
      remote !== MISSING && hasOwn(remote, key) ? remote[key] : MISSING,
      propertyPath(path, key),
      conflicts
    );

    if (child !== MISSING) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: child,
      });
    }
  }

  return result;
}

function indexOrders(orders) {
  const index = new Map();
  for (const order of orders) index.set(order.id, order);
  return index;
}

function sequenceEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function insertMissingByReference(target, reference, retained) {
  const present = new Set(target);
  const candidates = reference.filter((id) => retained.has(id) && !present.has(id));
  if (candidates.length === 0) return target;

  const candidateSet = new Set(candidates);
  const before = new Map();
  const after = new Map();
  let pending = [];
  let previousAnchor = null;

  for (const id of reference) {
    if (present.has(id)) {
      if (pending.length > 0) {
        before.set(id, [...(before.get(id) || []), ...pending]);
        pending = [];
      }
      previousAnchor = id;
    } else if (candidateSet.has(id)) {
      pending.push(id);
    }
  }

  if (pending.length > 0) {
    if (previousAnchor === null) return [...target, ...pending];
    after.set(previousAnchor, [...(after.get(previousAnchor) || []), ...pending]);
  }

  const result = [];
  for (const id of target) {
    if (before.has(id)) result.push(...before.get(id));
    result.push(id);
    if (after.has(id)) result.push(...after.get(id));
  }
  return result;
}

function mergeOrderSequence(baseOrders, localOrders, remoteOrders, retained, conflicts, path) {
  const baseIds = baseOrders.map((order) => order.id);
  const localIds = localOrders.map((order) => order.id);
  const remoteIds = remoteOrders.map((order) => order.id);
  const localSet = new Set(localIds);
  const remoteSet = new Set(remoteIds);
  const commonBase = baseIds.filter((id) => localSet.has(id) && remoteSet.has(id));
  const commonSet = new Set(commonBase);
  const localCommon = localIds.filter((id) => commonSet.has(id));
  const remoteCommon = remoteIds.filter((id) => commonSet.has(id));
  const localReordered = !sequenceEqual(localCommon, commonBase);
  const remoteReordered = !sequenceEqual(remoteCommon, commonBase);

  if (localReordered && remoteReordered && !sequenceEqual(localCommon, remoteCommon)) {
    conflict(conflicts, path, 'concurrent-order-reorder', {
      baseOrder: commonBase,
      localOrder: localCommon,
      remoteOrder: remoteCommon,
    });
  }

  let sourceOrder = baseIds;
  if (localReordered) sourceOrder = localIds;
  else if (remoteReordered) sourceOrder = remoteIds;

  const included = new Set();
  let ordered = sourceOrder.filter((id) => {
    if (!retained.has(id) || included.has(id)) return false;
    included.add(id);
    return true;
  });
  ordered = insertMissingByReference(ordered, localIds, retained);
  ordered = insertMissingByReference(ordered, remoteIds, retained);
  ordered = insertMissingByReference(ordered, baseIds, retained);
  return ordered;
}

function mergeOrders(base, local, remote, path, conflicts) {
  const baseOrders = base === MISSING ? [] : base;
  const localOrders = local === MISSING ? [] : local;
  const remoteOrders = remote === MISSING ? [] : remote;
  const baseIndex = indexOrders(baseOrders);
  const localIndex = indexOrders(localOrders);
  const remoteIndex = indexOrders(remoteOrders);
  const ids = [];
  const seen = new Set();

  for (const collection of [baseOrders, localOrders, remoteOrders]) {
    for (const order of collection) {
      if (seen.has(order.id)) continue;
      seen.add(order.id);
      ids.push(order.id);
    }
  }

  const mergedById = new Map();
  for (const id of ids) {
    const baseOrder = baseIndex.has(id) ? baseIndex.get(id) : MISSING;
    const localOrder = localIndex.has(id) ? localIndex.get(id) : MISSING;
    const remoteOrder = remoteIndex.has(id) ? remoteIndex.get(id) : MISSING;
    const currentPath = orderPath(path, id);

    if (baseOrder === MISSING) {
      if (localOrder !== MISSING && remoteOrder !== MISSING) {
        if (deepEqual(localOrder, remoteOrder)) {
          mergedById.set(id, cloneMerged(localOrder));
        } else {
          conflict(conflicts, currentPath, 'concurrent-order-add', { orderId: id });
        }
      } else {
        mergedById.set(id, cloneMerged(localOrder !== MISSING ? localOrder : remoteOrder));
      }
      continue;
    }

    if (localOrder === MISSING && remoteOrder === MISSING) continue;
    if (localOrder === MISSING) {
      if (!deepEqual(remoteOrder, baseOrder)) {
        conflict(conflicts, currentPath, 'delete-edit', { orderId: id });
      }
      continue;
    }
    if (remoteOrder === MISSING) {
      if (!deepEqual(localOrder, baseOrder)) {
        conflict(conflicts, currentPath, 'delete-edit', { orderId: id });
      }
      continue;
    }

    const mergedOrder = mergeNode(baseOrder, localOrder, remoteOrder, currentPath, conflicts);
    if (mergedOrder !== MISSING) mergedById.set(id, mergedOrder);
  }

  const orderedIds = mergeOrderSequence(
    baseOrders,
    localOrders,
    remoteOrders,
    new Set(mergedById.keys()),
    conflicts,
    path
  );
  return orderedIds.map((id) => mergedById.get(id));
}

function mergeNode(base, local, remote, path, conflicts) {
  if (deepEqual(local, remote)) return cloneMerged(local);
  if (deepEqual(local, base)) return cloneMerged(remote);
  if (deepEqual(remote, base)) return cloneMerged(local);

  if (base !== MISSING && (local === MISSING || remote === MISSING)) {
    return conflict(conflicts, path, 'delete-edit');
  }

  if (
    path === '$.orders' &&
    (base === MISSING || Array.isArray(base)) &&
    (local === MISSING || Array.isArray(local)) &&
    (remote === MISSING || Array.isArray(remote))
  ) {
    return mergeOrders(base, local, remote, path, conflicts);
  }

  if (base === MISSING) {
    if (isPlainObject(local) && isPlainObject(remote)) {
      return mergeRecord(MISSING, local, remote, path, conflicts);
    }
    return conflict(conflicts, path, 'concurrent-add');
  }

  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    return mergeRecord(base, local, remote, path, conflicts);
  }

  return conflict(conflicts, path, 'concurrent-edit');
}

function validateOrders(state, source, conflicts) {
  if (!hasOwn(state, 'orders')) {
    conflicts.push({ source, path: '$.orders', kind: 'missing-orders' });
    return;
  }
  if (!Array.isArray(state.orders)) {
    conflicts.push({ source, path: '$.orders', kind: 'invalid-orders' });
    return;
  }

  const seen = new Map();
  for (let index = 0; index < state.orders.length; index += 1) {
    const order = state.orders[index];
    const path = `$.orders[${index}]`;
    if (!isPlainObject(order)) {
      conflicts.push({ source, path, kind: 'invalid-order' });
      continue;
    }

    const id = order.id;
    const collisionKey = typeof id === 'string' || typeof id === 'number' ? String(id) : null;
    if (collisionKey !== null && seen.has(collisionKey)) {
      const previous = seen.get(collisionKey);
      conflicts.push({
        source,
        path: orderPath('$.orders', id),
        kind: previous.id === id ? 'duplicate-order-id' : 'order-id-collision',
        orderId: id,
        collidesWith: previous.id,
      });
    } else if (collisionKey !== null) {
      seen.set(collisionKey, { id, path });
    }

    if (typeof id !== 'string' || !ORDER_ID_PATTERN.test(id)) {
      conflicts.push({ source, path: `${path}.id`, kind: 'invalid-order-id' });
    }
  }
}

function validateState(value, source = 'value') {
  const conflicts = [];
  if (!isPlainObject(value)) {
    conflicts.push({ source, path: '$', kind: 'invalid-state' });
    return conflicts;
  }

  const jsonIssues = inspectJsonValue(value, source);
  conflicts.push(...jsonIssues);
  if (jsonIssues.length === 0) validateOrders(value, source, conflicts);
  return conflicts;
}

function assertValidState(value, label = 'state') {
  const conflicts = validateState(value, label);
  if (conflicts.length === 0) return;
  const error = new TypeError(`${label} must be a safe full store with canonical order IDs`);
  error.code = 'INVALID_STATE';
  error.conflicts = conflicts;
  throw error;
}

function threeWayMergeState(base, local, remote) {
  const conflicts = [
    ...validateState(base, 'base'),
    ...validateState(local, 'local'),
    ...validateState(remote, 'remote'),
  ];
  if (conflicts.length > 0) return { ok: false, conflicts };

  const merged = mergeNode(base, local, remote, '$', conflicts);
  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true, merged };
}

module.exports = {
  DEFAULT_JSON_LIMITS,
  ORDER_ID_PATTERN,
  assertSafeJson,
  assertValidState,
  canonicalJsonStringify,
  cloneJsonValue,
  inspectJsonValue,
  threeWayMergeState,
  validateState,
};

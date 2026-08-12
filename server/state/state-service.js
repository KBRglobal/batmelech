'use strict';

// The repository owns the locked remote read and the three-way merge. Keeping
// that work inside one transaction prevents callers from pairing a timestamp
// with unrelated remote content.

function createStateSafetyService({ repository } = {}) {
  if (
    !repository ||
    typeof repository.loadState !== 'function' ||
    typeof repository.saveState !== 'function'
  ) {
    throw new TypeError('A state repository is required');
  }

  async function loadState() {
    return repository.loadState();
  }

  async function mergeAndSave({
    baseState,
    localState,
    baseRevision,
    baseHash,
    requestId,
  } = {}) {
    const saved = await repository.saveState({
      baseState,
      localState,
      baseRevision,
      baseHash,
      requestId,
    });

    if (!saved.ok) {
      return {
        ...saved,
        stage: saved.conflict && saved.conflict.kind === 'merge-conflict'
          ? 'merge'
          : 'persistence',
      };
    }

    return saved;
  }

  return Object.freeze({ loadState, mergeAndSave });
}

module.exports = { createStateSafetyService };

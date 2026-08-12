'use strict';

async function startAfterStateInitialization({ repository, listen, closePool } = {}) {
  if (repository && typeof repository.initialize !== 'function') {
    throw new TypeError('repository.initialize must be a function');
  }
  if (typeof listen !== 'function') throw new TypeError('listen must be a function');
  if (typeof closePool !== 'undefined' && typeof closePool !== 'function') {
    throw new TypeError('closePool must be a function');
  }

  try {
    if (repository) await repository.initialize();
    return await listen();
  } catch (error) {
    if (closePool) {
      try {
        await closePool();
      } catch (closeError) {
        error.closeError = closeError;
      }
    }
    throw error;
  }
}

module.exports = { startAfterStateInitialization };

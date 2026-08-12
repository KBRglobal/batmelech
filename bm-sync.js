// Injected by server.js into every legacy HTML page. It keeps the browser's
// complete local store and the exact server revision it was based on, then
// submits an idempotent three-way-merge command. A conflict never overwrites
// either the browser copy or the server copy.
(function () {
  'use strict';

  var STORE_KEY = 'batmelech-orders-v1';
  var LEGACY_TS_KEY = 'bm-sync-ts';
  var BASE_KEY = 'bm-sync-v2-base';
  var PENDING_KEY = 'bm-sync-v2-pending';
  var CONFLICT_ID = 'bm-sync-conflict';
  var SAVE_DELAY_MS = 1200;
  var RETRY_DELAY_MS = 5000;
  var timer = null;
  var inFlight = false;
  var base = readJson(BASE_KEY);
  var originalSetItem = Storage.prototype.setItem;
  var originalRemoveItem = Storage.prototype.removeItem;

  function readJson(key) {
    var raw = localStorage.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }

  function isState(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
      Array.isArray(value.orders));
  }

  function isHash(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  }

  function isEnvelope(value) {
    return Boolean(value && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
      value.ts === value.revision && isHash(value.hash) && isState(value.data));
  }

  function isBase(value) {
    return isEnvelope(value);
  }

  function setInternal(key, value) {
    originalSetItem.call(localStorage, key, value);
  }

  function removeInternal(key) {
    originalRemoveItem.call(localStorage, key);
  }

  function setBase(envelope) {
    base = {
      revision: envelope.revision,
      ts: envelope.ts,
      hash: envelope.hash,
      data: envelope.data,
    };
    setInternal(BASE_KEY, JSON.stringify(base));
    setInternal(LEGACY_TS_KEY, String(base.revision));
  }

  function sameState(left, right) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch (_error) {
      return false;
    }
  }

  function requestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return 'browser-' + window.crypto.randomUUID();
    }
    var random = Math.random().toString(36).slice(2);
    return 'browser-' + Date.now().toString(36) + '-' + random;
  }

  function announceConflict(reason) {
    if (typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('bm-sync-conflict', {
        detail: { reason: reason },
      }));
    }
    if (!document || !document.body || document.getElementById(CONFLICT_ID)) return;
    var alert = document.createElement('div');
    alert.id = CONFLICT_ID;
    alert.dir = 'rtl';
    alert.setAttribute('role', 'alert');
    alert.style.cssText = 'position:fixed;z-index:2147483647;inset:12px 12px auto 12px;' +
      'padding:14px 18px;border:2px solid #7f1d1d;border-radius:12px;' +
      'background:#fff7ed;color:#7f1d1d;font:700 15px/1.5 Arial,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.18);text-align:right';
    alert.textContent = 'נמצאה התנגשות בשמירת ההזמנות. שום הזמנה לא נדרסה. ' +
      'השינויים נשמרו בחלון הזה לבדיקה לפני ניסיון נוסף.';
    document.body.appendChild(alert);
  }

  function clearConflict() {
    var alert = document && document.getElementById(CONFLICT_ID);
    if (alert && alert.parentNode) alert.parentNode.removeChild(alert);
  }

  function validPending(value, localRaw) {
    return Boolean(value && typeof value === 'object' &&
      typeof value.requestId === 'string' && value.requestId.length > 0 &&
      value.baseRevision === base.revision && value.baseHash === base.hash &&
      value.localRaw === localRaw);
  }

  function pendingFor(localRaw) {
    var pending = readJson(PENDING_KEY);
    if (validPending(pending, localRaw)) return pending;
    pending = {
      requestId: requestId(),
      baseRevision: base.revision,
      baseHash: base.hash,
      localRaw: localRaw,
    };
    setInternal(PENDING_KEY, JSON.stringify(pending));
    return pending;
  }

  function schedule(delay) {
    if (timer || inFlight) return;
    timer = setTimeout(function () {
      timer = null;
      push(false);
    }, delay);
  }

  function push(keepalive) {
    if (inFlight || !isBase(base)) return;
    var localRaw = localStorage.getItem(STORE_KEY);
    if (localRaw == null) return;
    var localState;
    try {
      localState = JSON.parse(localRaw);
    } catch (_error) {
      return;
    }
    if (!isState(localState)) return;
    if (sameState(localState, base.data)) {
      removeInternal(PENDING_KEY);
      return;
    }

    var pending = pendingFor(localRaw);
    var retryNeeded = false;
    var command = {
      baseState: base.data,
      localState: localState,
      baseRevision: base.revision,
      baseHash: base.hash,
      requestId: pending.requestId,
    };
    inFlight = true;

    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(command),
      credentials: 'same-origin',
      keepalive: Boolean(keepalive),
    })
      .then(function (response) {
        if (response.status !== 200 && response.status !== 409) throw new Error('state request failed');
        return response.json();
      })
      .then(function (result) {
        if (result && result.ok === true && isEnvelope(result)) {
          var unchangedDuringSave = localStorage.getItem(STORE_KEY) === localRaw;
          setBase(result);
          removeInternal(PENDING_KEY);
          clearConflict();
          if (unchangedDuringSave) {
            setInternal(STORE_KEY, JSON.stringify(result.data));
          } else {
            schedule(0);
          }
          return;
        }
        if (result && result.ok === false && result.conflict) {
          announceConflict(result.conflict.kind || 'conflict');
          return;
        }
        throw new Error('invalid state response');
      })
      .catch(function () {
        retryNeeded = true;
      })
      .finally(function () {
        inFlight = false;
        if (retryNeeded) schedule(RETRY_DELAY_MS);
        else if (localStorage.getItem(STORE_KEY) !== localRaw) schedule(0);
      });
  }

  function pullBeforeBoot() {
    var localRaw = localStorage.getItem(STORE_KEY);
    var localState = null;
    try {
      if (localRaw != null) localState = JSON.parse(localRaw);
    } catch (_error) {}

    try {
      var request = new XMLHttpRequest();
      request.open('GET', '/api/state', false);
      request.send();
      if (request.status !== 200) return;
      var remote = JSON.parse(request.responseText);
      if (!isEnvelope(remote)) return;

      if (isBase(base) && isState(localState)) {
        if (base.revision === remote.revision && base.hash === remote.hash) {
          if (!sameState(localState, base.data)) schedule(0);
          return;
        }
        if (sameState(localState, base.data)) {
          setInternal(STORE_KEY, JSON.stringify(remote.data));
          setBase(remote);
          removeInternal(PENDING_KEY);
          return;
        }
        schedule(0);
        return;
      }

      var legacyRevision = Number(localStorage.getItem(LEGACY_TS_KEY) || 0);
      if (localRaw == null || sameState(localState, remote.data)) {
        setInternal(STORE_KEY, JSON.stringify(remote.data));
        setBase(remote);
        return;
      }
      if (legacyRevision === remote.revision) {
        setBase(remote);
        schedule(0);
        return;
      }

      announceConflict('unversioned-local-state');
    } catch (_error) {
      /* Offline: keep the local copy and refuse an unversioned write. */
    }
  }

  pullBeforeBoot();

  Storage.prototype.setItem = function (key) {
    originalSetItem.apply(this, arguments);
    if (this === window.localStorage && key === STORE_KEY) schedule(SAVE_DELAY_MS);
  };

  window.addEventListener('pagehide', function () {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    push(true);
  });
})();

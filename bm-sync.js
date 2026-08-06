// Injected by server.js into every HTML page. Mirrors the app's localStorage
// state (key: batmelech-orders-v1) to the server's Postgres store.
// Strategy: last-write-wins by server timestamp. App code is never modified.
(function () {
  var KEY = 'batmelech-orders-v1';
  var TS = 'bm-sync-ts';
  var timer = null;

  // Pull server state synchronously BEFORE the app boots, so the app reads
  // the freshest data. Same-origin, tiny payload — acceptable blocking.
  try {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/state', false);
    x.send();
    if (x.status === 200) {
      var r = JSON.parse(x.responseText);
      var localTs = parseInt(localStorage.getItem(TS) || '0', 10);
      if (r && r.ts && r.data && r.ts > localTs) {
        localStorage.setItem(KEY, JSON.stringify(r.data));
        localStorage.setItem(TS, String(r.ts));
      }
    }
  } catch (e) {
    /* offline or no db — app keeps working from localStorage */
  }

  function pushSoon() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      var raw = localStorage.getItem(KEY);
      if (raw == null) return;
      var parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return;
      }
      fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: parsed }),
      })
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (r) {
          if (r && r.ts) localStorage.setItem(TS, String(r.ts));
        })
        .catch(function () {});
    }, 1200);
  }

  var origSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    origSetItem.apply(this, arguments);
    if (this === window.localStorage && k === KEY) pushSoon();
  };

  // Flush pending changes when the page is being closed/backgrounded.
  window.addEventListener('pagehide', function () {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    var raw = localStorage.getItem(KEY);
    if (raw == null) return;
    try {
      navigator.sendBeacon(
        '/api/state',
        new Blob(['{"data":' + raw + '}'], { type: 'application/json' })
      );
    } catch (e) {}
  });
})();

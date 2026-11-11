/* Resident Olympics — data layer.
 *
 * One small interface with two implementations:
 *   - Firebase (Firestore + anonymous sign-in) when config.js holds a config: real, cross-device play.
 *   - Demo (IndexedDB + BroadcastChannel) otherwise: tabs of one browser only, for rehearsal.
 *
 * Interface:
 *   mode            "live" | "demo"
 *   uid             this device's id
 *   TS              placeholder the server replaces with its own clock time
 *   now()           best estimate of the server clock, in ms
 *   setDoc(path, data, {merge, createOnly, calibrate})
 *   deleteDoc(path)
 *   getDoc(path)    -> object | null
 *   onDoc(path, cb, onError)        -> unsubscribe
 *   onCol(path, cb, onError)        -> unsubscribe; cb receives [{id, ...data}]
 * Timestamps are always delivered as millisecond numbers.
 */
(function () {
  "use strict";
  const RO = (window.RO = window.RO || {});
  const TS = Object.freeze({ __serverTimestamp: true });

  function isPlain(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }
  function clone(v) {
    return v == null ? null : JSON.parse(JSON.stringify(v));
  }
  function deepMerge(base, patch) {
    const out = isPlain(base) ? Object.assign({}, base) : {};
    Object.keys(patch).forEach(function (k) {
      out[k] = isPlain(patch[k]) && isPlain(out[k]) ? deepMerge(out[k], patch[k]) : patch[k];
    });
    return out;
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () {
        reject(new Error("Could not load " + src));
      };
      document.head.appendChild(s);
    });
  }

  /* ---------- Demo backend ---------- */
  function openIdb() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open("ro-demo-db", 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore("docs");
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  async function makeDemo() {
    const cache = new Map();
    let idb = null;
    try {
      idb = await openIdb();
      await new Promise(function (resolve, reject) {
        const tx = idb.transaction("docs", "readonly");
        const cur = tx.objectStore("docs").openCursor();
        cur.onsuccess = function () {
          const c = cur.result;
          if (!c) return resolve();
          cache.set(c.key, c.value);
          c.continue();
        };
        cur.onerror = function () {
          reject(cur.error);
        };
      });
    } catch (e) {
      idb = null; // private window: keep working in memory for this tab
    }
    const docL = new Map();
    const colL = new Map();
    const chan = "BroadcastChannel" in window ? new BroadcastChannel("ro-demo") : null;

    function parentOf(path) {
      return path.slice(0, path.lastIndexOf("/"));
    }
    function listCol(col) {
      const out = [];
      const prefix = col + "/";
      cache.forEach(function (data, path) {
        if (path.startsWith(prefix) && path.indexOf("/", prefix.length) === -1) {
          out.push(Object.assign({ id: path.slice(prefix.length) }, clone(data)));
        }
      });
      return out;
    }
    function notify(path) {
      (docL.get(path) || []).forEach(function (cb) {
        cb(clone(cache.get(path)));
      });
      const p = parentOf(path);
      (colL.get(p) || []).forEach(function (cb) {
        cb(listCol(p));
      });
    }
    function apply(path, data) {
      if (data === null) cache.delete(path);
      else cache.set(path, data);
      notify(path);
    }
    if (chan) {
      chan.onmessage = function (e) {
        apply(e.data.path, e.data.data);
      };
    }
    function write(path, data) {
      apply(path, data);
      if (idb) {
        const store = idb.transaction("docs", "readwrite").objectStore("docs");
        if (data === null) store.delete(path);
        else store.put(data, path);
      }
      if (chan) chan.postMessage({ path: path, data: data });
    }
    function stamp(v) {
      if (v === TS) return Date.now();
      if (Array.isArray(v)) return v.map(stamp);
      if (isPlain(v)) {
        const o = {};
        Object.keys(v).forEach(function (k) {
          o[k] = stamp(v[k]);
        });
        return o;
      }
      return v;
    }
    function addListener(map, path, cb) {
      if (!map.has(path)) map.set(path, new Set());
      map.get(path).add(cb);
      return function () {
        map.get(path).delete(cb);
      };
    }

    let uid = null;
    try {
      uid = sessionStorage.getItem("ro-demo-uid");
    } catch (e) {}
    if (!uid) {
      uid = "demo" + Math.random().toString(36).slice(2, 10);
      try {
        sessionStorage.setItem("ro-demo-uid", uid);
      } catch (e) {}
    }

    return {
      mode: "demo",
      uid: uid,
      TS: TS,
      now: function () {
        return Date.now();
      },
      setDoc: async function (path, data, opts) {
        opts = opts || {};
        if (opts.createOnly && cache.has(path)) throw new Error("already-exists");
        let next = stamp(data);
        if (opts.merge) next = deepMerge(cache.get(path) || {}, next);
        write(path, next);
      },
      deleteDoc: async function (path) {
        write(path, null);
      },
      getDoc: async function (path) {
        return clone(cache.get(path));
      },
      onDoc: function (path, cb) {
        const off = addListener(docL, path, cb);
        Promise.resolve().then(function () {
          cb(clone(cache.get(path)));
        });
        return off;
      },
      onCol: function (path, cb) {
        const off = addListener(colL, path, cb);
        Promise.resolve().then(function () {
          cb(listCol(path));
        });
        return off;
      },
    };
  }

  /* ---------- Firebase backend ---------- */
  async function makeFirebase(cfg) {
    await loadScript("vendor/firebase-app-compat.js");
    await loadScript("vendor/firebase-auth-compat.js");
    await loadScript("vendor/firebase-firestore-compat.js");
    const firebase = window.firebase;
    firebase.initializeApp(cfg);
    const auth = firebase.auth();
    const fs = firebase.firestore();
    if (window.RO_EMULATOR) {
      auth.useEmulator("http://127.0.0.1:" + window.RO_EMULATOR.auth, { disableWarnings: true });
      fs.useEmulator("127.0.0.1", window.RO_EMULATOR.firestore);
    }
    await new Promise(function (resolve) {
      const off = auth.onAuthStateChanged(function () {
        off();
        resolve();
      });
    });
    if (!auth.currentUser) await auth.signInAnonymously();

    const Timestamp = firebase.firestore.Timestamp;
    const serverTs = firebase.firestore.FieldValue.serverTimestamp();
    let offset = 0;

    function toStore(v) {
      if (v === TS) return serverTs;
      if (Array.isArray(v)) return v.map(toStore);
      if (isPlain(v)) {
        const o = {};
        Object.keys(v).forEach(function (k) {
          if (v[k] !== undefined) o[k] = toStore(v[k]);
        });
        return o;
      }
      return v;
    }
    function fromStore(v) {
      if (v instanceof Timestamp) return v.toMillis();
      if (Array.isArray(v)) return v.map(fromStore);
      if (isPlain(v)) {
        const o = {};
        Object.keys(v).forEach(function (k) {
          o[k] = fromStore(v[k]);
        });
        return o;
      }
      return v;
    }
    const snapOpts = { serverTimestamps: "estimate" };

    return {
      mode: "live",
      uid: auth.currentUser.uid,
      TS: TS,
      now: function () {
        return Date.now() + offset;
      },
      setDoc: async function (path, data, opts) {
        opts = opts || {};
        const ref = fs.doc(path);
        const sent = Date.now();
        await ref.set(toStore(data), opts.merge ? { merge: true } : {});
        if (opts.calibrate) {
          // Compare the server's write time with this device's clock so timers agree across phones.
          const acked = Date.now();
          try {
            const snap = await ref.get({ source: "server" });
            const t = snap.get(opts.calibrate);
            if (t instanceof Timestamp) offset = t.toMillis() - (sent + acked) / 2;
          } catch (e) {}
        }
      },
      deleteDoc: function (path) {
        return fs.doc(path).delete();
      },
      getDoc: async function (path) {
        const snap = await fs.doc(path).get();
        return snap.exists ? fromStore(snap.data(snapOpts)) : null;
      },
      onDoc: function (path, cb, onError) {
        return fs.doc(path).onSnapshot(
          function (snap) {
            cb(snap.exists ? fromStore(snap.data(snapOpts)) : null);
          },
          function (err) {
            if (onError) onError(err);
          }
        );
      },
      onCol: function (path, cb, onError) {
        return fs.collection(path).onSnapshot(
          function (snap) {
            cb(
              snap.docs.map(function (d) {
                return Object.assign({ id: d.id }, fromStore(d.data(snapOpts)));
              })
            );
          },
          function (err) {
            if (onError) onError(err);
          }
        );
      },
    };
  }

  RO.createBackend = function () {
    const cfg = window.RO_FIREBASE_CONFIG;
    return cfg && cfg.apiKey ? makeFirebase(cfg) : makeDemo();
  };
})();

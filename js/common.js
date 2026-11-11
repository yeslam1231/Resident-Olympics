/* Resident Olympics — shared helpers: DOM, quiz format, images, scoring. */
(function () {
  "use strict";
  const RO = (window.RO = window.RO || {});

  RO.LETTERS = ["A", "B", "C", "D", "E"];
  RO.MAX_OPTIONS = 5;

  /* ---------- DOM ---------- */
  // h("div.card.big", {onclick: fn, title: "x"}, child, "text", [more])
  RO.h = function (spec, attrs) {
    const parts = spec.split(".");
    const node = document.createElement(parts[0] || "div");
    if (parts.length > 1) node.className = parts.slice(1).join(" ");
    let start = 1;
    if (attrs && typeof attrs === "object" && !(attrs instanceof Node) && !Array.isArray(attrs)) {
      start = 2;
      Object.keys(attrs).forEach(function (k) {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
        else if (k === "style") node.style.cssText = v;
        else if (k === "value") node.value = v;
        else if (k === "checked" || k === "disabled" || k === "selected" || k === "hidden") node[k] = !!v;
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    function add(c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    for (let i = start; i < arguments.length; i++) add(arguments[i]);
    return node;
  };

  RO.mount = function (root, node) {
    root.replaceChildren(node);
  };

  let toastTimer = null;
  RO.toast = function (msg, kind) {
    let t = document.getElementById("toast");
    if (!t) {
      t = RO.h("div", { id: "toast", role: "status" });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = "show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.className = "";
    }, 4200);
  };

  RO.keepAwake = function () {
    function ask() {
      if (navigator.wakeLock && document.visibilityState === "visible") {
        navigator.wakeLock.request("screen").catch(function () {});
      }
    }
    ask();
    document.addEventListener("visibilitychange", ask);
  };

  /* ---------- Small utilities ---------- */
  RO.uid = function () {
    return Math.random().toString(36).slice(2, 10);
  };
  // No vowels (no accidental words), no look-alikes (0/O, 1/I/L).
  RO.gameCode = function () {
    const abc = "BCDFGHJKMNPQRSTVWXYZ";
    let s = "";
    for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  };
  RO.fmtScore = function (n) {
    const r = Math.round(n * 10) / 10;
    return r.toLocaleString("en-US", { maximumFractionDigits: 1 });
  };
  RO.ordinal = function (n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  /* ---------- Quiz format ---------- */
  RO.blankQuestion = function () {
    return { id: RO.uid(), text: "", image: "", options: ["", "", "", ""], correct: 0, seconds: 30, points: 1, explanation: "" };
  };

  // Accepts anything (an imported file, an old save) and returns a clean quiz.
  RO.normalizeQuiz = function (raw) {
    raw = raw && typeof raw === "object" ? raw : {};
    const qs = Array.isArray(raw.questions) ? raw.questions : [];
    return {
      format: "resident-olympics-quiz",
      version: 1,
      title: String(raw.title || "Resident Olympics").slice(0, 80),
      questions: qs
        .filter(function (q) {
          return q && typeof q === "object";
        })
        .map(function (q) {
          let options = (Array.isArray(q.options) ? q.options : []).map(String).slice(0, RO.MAX_OPTIONS);
          while (options.length < 2) options.push("");
          let correct = Number.isInteger(q.correct) ? q.correct : 0;
          if (correct < 0 || correct >= options.length) correct = 0;
          const seconds = Math.min(600, Math.max(5, Math.round(Number(q.seconds) || 30)));
          const points = Math.min(10, Math.max(1, Math.round(Number(q.points) || 1)));
          return {
            id: String(q.id || RO.uid()),
            text: String(q.text || ""),
            image: typeof q.image === "string" ? q.image : "",
            options: options,
            correct: correct,
            seconds: seconds,
            points: points,
            explanation: String(q.explanation || ""),
          };
        }),
    };
  };

  RO.questionProblem = function (q) {
    if (!q.text.trim() && !q.image) return "needs a question or an image";
    const filled = q.options.filter(function (o) {
      return o.trim();
    }).length;
    if (filled < q.options.length) return "has an empty answer choice";
    return "";
  };

  /* ---------- Images ---------- */
  // Shrinks a photo to a JPEG data URL no longer than maxChars, so it fits where it is stored.
  RO.imageFileToDataURL = async function (file, maxDim, maxChars) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise(function (resolve, reject) {
        const im = new Image();
        im.onload = function () {
          resolve(im);
        };
        im.onerror = function () {
          reject(new Error("That file is not an image this browser can read."));
        };
        im.src = url;
      });
      let dim = maxDim;
      const qualities = [0.86, 0.76, 0.66, 0.55];
      for (let pass = 0; pass < 6; pass++) {
        const scale = Math.min(1, dim / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        for (let i = 0; i < qualities.length; i++) {
          const out = c.toDataURL("image/jpeg", qualities[i]);
          if (out.length <= maxChars) return out;
        }
        dim = Math.round(dim * 0.8);
      }
      throw new Error("That image could not be made small enough.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  /* ---------- Scoring ---------- */
  // One answer's points. "speed": 1000 per point value, sliding to 500 at the buzzer.
  // "plain": the question's point value, nothing for speed.
  RO.answerPoints = function (isCorrect, elapsedMs, seconds, points, scoring) {
    if (!isCorrect) return 0;
    if (scoring !== "speed") return points;
    const left = Math.min(1, Math.max(0, 1 - elapsedMs / (seconds * 1000)));
    return Math.round(1000 * points * (0.5 + 0.5 * left));
  };

  // Builds the full standings from raw answers. Recomputed from scratch each time,
  // so a host reload mid-game loses nothing.
  //   players  [{id, name, team}]
  //   answers  [{q, uid, choice, at}]
  //   keys     [{correct, seconds, points}] indexed by question number
  //   starts   {questionNumber: ms}
  //   upto     last question number whose answer is revealed
  RO.computeBoard = function (players, answers, keys, starts, upto, scoring) {
    const rows = new Map();
    players.forEach(function (p) {
      rows.set(p.id, { uid: p.id, name: p.name || "Player", team: p.team || "", score: 0, time: 0, right: 0, delta: 0, choice: -1, correct: false });
    });
    answers.forEach(function (a) {
      const r = rows.get(a.uid);
      const key = keys[a.q];
      if (!r || !key || a.q > upto) return;
      const elapsed = Math.max(0, (a.at || 0) - (starts[a.q] || a.at || 0));
      const ok = a.choice === key.correct;
      const pts = RO.answerPoints(ok, elapsed, key.seconds, key.points, scoring);
      r.score += pts;
      if (ok) {
        r.right += 1;
        r.time += Math.min(elapsed, key.seconds * 1000);
      }
      if (a.q === upto) {
        r.delta = pts;
        r.choice = a.choice;
        r.correct = ok;
      }
    });
    const list = Array.from(rows.values());
    // Ties on score go to whoever spent less time on their correct answers.
    list.sort(function (a, b) {
      return b.score - a.score || a.time - b.time || a.name.localeCompare(b.name);
    });
    list.forEach(function (r, i) {
      const prev = list[i - 1];
      r.rank = prev && prev.score === r.score && prev.time === r.time ? prev.rank : i + 1;
      r.time = Math.round(r.time);
    });
    const teamMap = new Map();
    list.forEach(function (r) {
      if (!r.team) return;
      if (!teamMap.has(r.team)) teamMap.set(r.team, { name: r.team, total: 0, members: 0, time: 0 });
      const t = teamMap.get(r.team);
      t.total += r.score;
      t.time += r.time;
      t.members += 1;
    });
    // A team's score is the average of its members, so team size does not decide the result.
    const teams = Array.from(teamMap.values()).map(function (t) {
      return { name: t.name, members: t.members, score: Math.round((t.total / t.members) * 10) / 10, time: Math.round(t.time / t.members) };
    });
    teams.sort(function (a, b) {
      return b.score - a.score || a.time - b.time || a.name.localeCompare(b.name);
    });
    teams.forEach(function (t, i) {
      const prev = teams[i - 1];
      t.rank = prev && prev.score === t.score && prev.time === t.time ? prev.rank : i + 1;
    });
    return { rows: list, teams: teams };
  };

  /* ---------- Host's quiz, kept on this device ---------- */
  function openKv() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open("ro-host", 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore("kv");
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }
  RO.loadQuiz = async function () {
    try {
      const db = await openKv();
      const raw = await new Promise(function (resolve, reject) {
        const r = db.transaction("kv", "readonly").objectStore("kv").get("quiz");
        r.onsuccess = function () {
          resolve(r.result);
        };
        r.onerror = function () {
          reject(r.error);
        };
      });
      return raw ? RO.normalizeQuiz(raw) : null;
    } catch (e) {
      return null;
    }
  };
  RO.saveQuiz = async function (quiz) {
    const db = await openKv();
    await new Promise(function (resolve, reject) {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(quiz, "quiz");
      tx.oncomplete = resolve;
      tx.onerror = function () {
        reject(tx.error);
      };
    });
  };

  /* ---------- Sample questions ---------- */
  // A monitor-style strip of ventricular fibrillation, drawn rather than photographed.
  RO.sampleStrip = function () {
    const W = 960, H = 360, mid = 190;
    let seed = 7;
    function rnd() {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    }
    let d = "";
    let phase = 0;
    for (let x = 20; x <= W - 20; x += 3) {
      const env = 0.45 + 0.55 * Math.abs(Math.sin(x / 97 + 1.3) * Math.cos(x / 41));
      phase += 0.42 + rnd() * 0.3;
      const y = mid + Math.sin(phase) * 78 * env + Math.sin(phase * 2.3) * 16 + (rnd() - 0.5) * 12;
      d += (d ? "L" : "M") + x + " " + y.toFixed(1);
    }
    let grid = "";
    for (let x = 20; x <= W - 20; x += 40) grid += '<path d="M' + x + " 40V" + (H - 30) + '"/>';
    for (let y = 50; y <= H - 30; y += 40) grid += '<path d="M20 ' + y + "H" + (W - 20) + '"/>';
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '">' +
      '<rect width="' + W + '" height="' + H + '" fill="#04100c"/>' +
      '<g stroke="#123a2c" stroke-width="1" fill="none">' + grid + "</g>" +
      '<path d="' + d + '" fill="none" stroke="#5dff9b" stroke-width="3" stroke-linejoin="round"/>' +
      '<text x="30" y="32" fill="#5dff9b" font-family="monospace" font-size="22">II  25 mm/s  SAMPLE TRACE</text>' +
      "</svg>";
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  };

  RO.sampleQuiz = function () {
    return RO.normalizeQuiz({
      title: "Resident Olympics (sample round)",
      questions: [
        {
          text: "Sample: After the aortic cross-clamp comes off, the monitor shows this rhythm. What is the most appropriate immediate step?",
          image: RO.sampleStrip(),
          options: ["Internal defibrillation at 10–20 J", "Synchronised cardioversion at 200 J", "Intravenous adenosine", "Atrial pacing at 90 per minute"],
          correct: 0,
          seconds: 30,
          explanation: "Ventricular fibrillation after reperfusion is treated with internal paddles at 10–20 J.",
        },
        {
          text: "Sample: Which conduit has the best long-term patency when grafted to the left anterior descending artery?",
          options: ["Radial artery", "Left internal thoracic artery", "Great saphenous vein", "Right gastroepiploic artery"],
          correct: 1,
          seconds: 20,
          explanation: "The left internal thoracic artery to the LAD stays patent in over 90% of patients at 10 years.",
        },
        {
          text: "Sample: In most people, the artery to the atrioventricular node arises from which vessel?",
          options: ["Left anterior descending artery", "Left circumflex artery", "Right coronary artery", "Left main coronary artery"],
          correct: 2,
          seconds: 20,
          explanation: "The AV nodal artery comes off the right coronary artery in roughly 80–90% of hearts.",
        },
        {
          text: "Sample: A Stanford type A aortic dissection is defined by involvement of which segment?",
          options: ["Descending thoracic aorta only", "Abdominal aorta only", "Iliac arteries", "Ascending aorta"],
          correct: 3,
          seconds: 20,
          explanation: "Type A involves the ascending aorta, wherever the entry tear lies.",
        },
        {
          text: "Sample: Which drug reverses unfractionated heparin after cardiopulmonary bypass?",
          options: ["Vitamin K", "Tranexamic acid", "Protamine sulfate", "Idarucizumab"],
          correct: 2,
          seconds: 15,
          explanation: "Protamine binds heparin and neutralises it.",
        },
      ],
    });
  };
})();

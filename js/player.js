/* Resident Olympics — player: join on a phone, answer, see your standing. */
(function () {
  "use strict";
  const RO = window.RO;
  const h = RO.h;
  const root = document.getElementById("app");
  const SESSION_KEY = "ro-player";

  let be = null;
  let code = "";
  let lobbyInfo = null; // game doc fetched before joining
  let me = null; // {name, team}
  let G = null;
  let Q = null; // current question document
  let board = null;
  let unsubs = [];
  let picked = { q: -1, i: -1 };
  let sending = false;
  let note = "";
  let sceneKey = "";
  let qSubs = {}; // question number -> unsubscribe
  let qCache = {}; // question number -> question document

  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) {}
  }
  function myAnswer(n) {
    const v = lsGet("ro-ans-" + code + "-" + n + "-" + be.uid);
    return v == null ? -1 : Number(v);
  }
  function myRow() {
    return board && board.rows ? board.rows.find(function (r) { return r.uid === be.uid; }) : null;
  }

  function frame(body) {
    return h("div.phone",
      h("header.phone-head",
        h("div.brand", { style: "font-size:20px" }, "Resident ", h("b", "Olympics")),
        me ? h("div.me", me.name, me.team ? " · " + me.team : "") : null
      ),
      h("main.phone-body", body)
    );
  }

  /* ---------- Joining ---------- */
  function viewCode() {
    return frame([
      h("h1", "Join the game"),
      note ? h("div.notice", note) : null,
      be.mode === "demo" ? h("div.notice", h("strong", "Demo mode. "), "This only connects to a host open in another tab of this same browser.") : null,
      h("form", { style: "display:flex;flex-direction:column;gap:16px", onsubmit: function (e) {
        e.preventDefault();
        findGame(document.getElementById("code").value);
      } },
        h("label.field", h("span", "Game code from the big screen"),
          h("input", { type: "text", id: "code", value: code, maxlength: 4, autocomplete: "off", autocapitalize: "characters", spellcheck: "false", placeholder: "ABCD",
            style: "font:700 44px/1 var(--display);letter-spacing:0.2em;text-align:center;text-transform:uppercase" })),
        h("button.btn.primary.big", { type: "submit" }, "Continue")
      ),
    ]);
  }
  async function findGame(raw) {
    const c = String(raw || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (c.length < 4) {
      note = "Enter the four-letter code shown on the big screen.";
      return render();
    }
    try {
      const g = await be.getDoc("games/" + c);
      if (!g) {
        code = c;
        note = "No game with the code " + c + ". Check the big screen and try again.";
        lobbyInfo = null;
      } else {
        code = c;
        lobbyInfo = g;
        note = "";
      }
    } catch (e) {
      note = "Could not reach the game. Check your connection and try again.";
    }
    render();
  }
  function viewName() {
    const teams = lobbyInfo.teams || [];
    return frame([
      h("h1", lobbyInfo.title || "Resident Olympics"),
      note ? h("div.notice", note) : null,
      h("form", { style: "display:flex;flex-direction:column;gap:16px", onsubmit: function (e) {
        e.preventDefault();
        join(document.getElementById("name").value, teams.length ? document.getElementById("team").value : "");
      } },
        h("label.field", h("span", teams.length ? "Your name" : "Your name, or your team's name"),
          h("input", { type: "text", id: "name", maxlength: 24, autocomplete: "name", placeholder: "Dr. Al-Harbi", value: (me && me.name) || "" })),
        teams.length
          ? h("label.field", h("span", "Your team"),
              h("select", { id: "team" }, h("option", { value: "" }, "Choose a team…"), teams.map(function (t) { return h("option", { value: t }, t); })))
          : null,
        h("button.btn.primary.big", { type: "submit", disabled: sending }, "Join"),
        h("button.btn.quiet", { type: "button", onclick: function () { lobbyInfo = null; note = ""; render(); } }, "Use a different code")
      ),
    ]);
  }
  async function join(name, team) {
    name = String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
    if (!name) {
      note = "Enter a name so the scoreboard can show you.";
      return render();
    }
    if ((lobbyInfo.teams || []).length && !team) {
      note = "Choose your team.";
      return render();
    }
    sending = true;
    try {
      await be.setDoc("games/" + code + "/players/" + be.uid, { name: name, team: team || "", joinedAt: be.TS }, { calibrate: "joinedAt" });
      me = { name: name, team: team || "" };
      lsSet(SESSION_KEY, JSON.stringify({ code: code, name: me.name, team: me.team }));
      note = "";
      attach();
    } catch (e) {
      note = "Could not join. The game may have been closed.";
    }
    sending = false;
    render();
  }

  function attach() {
    detach();
    const base = "games/" + code;
    const lost = function () { RO.toast("Connection lost. Trying again…", "bad"); };
    unsubs.push(be.onDoc(base, function (d) {
      G = d;
      if (!d) return leave("The host closed this game.");
      watchQuestions();
      render();
    }, lost));
    let seenSelf = false;
    unsubs.push(be.onDoc(base + "/players/" + be.uid, function (d) {
      if (d) seenSelf = true;
      else if (seenSelf) leave("You were removed from the game. You can join again.");
    }, lost));
    unsubs.push(be.onDoc(base + "/meta/board", function (d) { board = d; render(); }, lost));
  }
  function detach() {
    unsubs.forEach(function (u) { u(); });
    unsubs = [];
    Object.keys(qSubs).forEach(function (k) { qSubs[k](); });
    qSubs = {};
    qCache = {};
    G = null;
    Q = null;
    board = null;
    sceneKey = "";
  }
  function leave(msg) {
    detach();
    lsSet(SESSION_KEY, null);
    lobbyInfo = null;
    me = null;
    note = msg || "";
    render();
  }
  // Questions arrive over a live connection and the next one is fetched ahead of time,
  // so it is already on the phone when the host starts the clock.
  function watchQuestions() {
    if (!G) return;
    const want = [Math.max(0, G.qIndex), G.qIndex + 1].filter(function (n) { return n < G.qCount; });
    Object.keys(qSubs).forEach(function (k) {
      if (want.indexOf(Number(k)) < 0) {
        qSubs[k]();
        delete qSubs[k];
        delete qCache[k];
      }
    });
    want.forEach(function (n) {
      if (qSubs[n]) return;
      const sub = function () {
        qSubs[n] = be.onDoc("games/" + code + "/questions/" + n, function (d) {
          if (!d) return;
          qCache[n] = d;
          if (d.image) new Image().src = d.image;
          if (G && G.qIndex === n) {
            Q = d;
            render();
          }
        }, function () {
          // Dropped connection: try again shortly rather than leaving the player waiting.
          delete qSubs[n];
          setTimeout(function () { if (G && !qSubs[n]) watchQuestions(); }, 2000);
        });
      };
      sub();
    });
    Q = qCache[G.qIndex] || null;
  }

  /* ---------- Answering ---------- */
  async function lockIn() {
    const n = G.qIndex;
    if (picked.q !== n || picked.i < 0 || sending) return;
    sending = true;
    render(true);
    try {
      await be.setDoc("games/" + code + "/answers/" + n + "_" + be.uid, { q: n, uid: be.uid, choice: picked.i, at: be.TS }, { createOnly: true });
      lsSet("ro-ans-" + code + "-" + n + "-" + be.uid, String(picked.i));
    } catch (e) {
      RO.toast("That answer did not get through. Time may be up.", "bad");
    }
    sending = false;
    render(true);
  }

  function questionCard(mine, open) {
    return [
      h("div.row", h("span.label.grow", "Question " + (G.qIndex + 1) + " of " + G.qCount),
        open ? h("span.num", { id: "p-secs", style: "font:700 26px/1 var(--display)" }, "") : null),
      open ? h("div.clock", h("div.trace", { style: "height:24px;background-size:auto 24px" }, h("i", { id: "p-fill", style: "width:100%;background-size:auto 24px" }))) : null,
      Q.text ? h("h2.q-text", Q.text) : null,
      Q.image ? h("div.q-media", h("img", { src: Q.image, alt: "Question image" })) : null,
      h("div.pick", Q.options.map(function (o, i) {
        const on = mine >= 0 ? mine === i : picked.q === G.qIndex && picked.i === i;
        return h("button", { type: "button", "data-i": i, "aria-pressed": String(on), disabled: !open || mine >= 0, onclick: function () {
          picked = { q: G.qIndex, i: i };
          render(true);
        } }, h("span.chip", { "data-i": i }, RO.LETTERS[i]), h("span", o));
      })),
    ];
  }

  function viewGame() {
    if (!G) return frame(h("div.center", h("p.muted", "Connecting…")));
    const n = G.qIndex;
    const mine = n >= 0 ? myAnswer(n) : -1;
    const row = myRow();

    if (G.phase === "lobby") {
      return frame(h("div.center",
        h("h1", "You're in"),
        h("p", "Watch the big screen. The first question appears here when the host starts."),
        h("p.muted", G.scoring === "speed" ? "Correct answers score more the faster you lock in." : "Each correct answer scores. Speed only breaks ties.")
      ));
    }
    if ((G.phase === "question" || G.phase === "locked" || G.phase === "reveal") && (!Q || Q.n !== n)) {
      return frame(h("div.center", h("p.muted", "Loading the question…")));
    }
    if (G.phase === "question") {
      if (mine >= 0) {
        return frame([
          questionCard(mine, false),
          h("div.notice", h("strong", "Locked in: " + RO.LETTERS[mine] + ". "), "Wait for the answer on the big screen."),
        ]);
      }
      const ready = picked.q === n && picked.i >= 0;
      return frame([
        questionCard(-1, true),
        h("button.btn.primary.big", { type: "button", id: "lock-in", disabled: !ready || sending, onclick: lockIn },
          sending ? "Sending…" : ready ? "Lock in " + RO.LETTERS[picked.i] : "Choose an answer"),
      ]);
    }
    if (G.phase === "locked") {
      return frame(h("div.center",
        h("h1", "Time"),
        h("p", mine >= 0 ? "You answered " + RO.LETTERS[mine] + ". The answer is coming up." : "No answer from you on this one.")
      ));
    }
    if (G.phase === "reveal" && G.reveal) {
      const ok = mine === G.reveal.correct;
      const gained = row && board.qIndex === n ? row.delta : null;
      return frame(h("div.center",
        h("div.verdict" + (mine < 0 ? "" : ok ? ".ok" : ".no"), mine < 0 ? "No answer" : ok ? "Correct" : "Not this time"),
        ok && gained != null ? h("div.bigstat", "+" + RO.fmtScore(gained)) : null,
        h("p", "Answer: ", h("b", RO.LETTERS[G.reveal.correct] + ". " + (Q.options[G.reveal.correct] || ""))),
        G.reveal.explanation ? h("p.muted", G.reveal.explanation) : null
      ));
    }
    // board / final
    const final = G.phase === "final";
    const top = board && board.rows ? board.rows.slice(0, 5) : [];
    const myTeam = row && row.team && board.teams ? board.teams.find(function (t) { return t.name === row.team; }) : null;
    return frame([
      h("div.center", { style: "flex:none;padding-block:10px" },
        h("span.label", final ? "Final result" : "After question " + (n + 1) + " of " + G.qCount),
        row ? h("div.bigstat", RO.ordinal(row.rank)) : h("p.muted", "Scores are on the big screen."),
        row ? h("p", h("b", RO.fmtScore(row.score)), " points · " + row.right + " correct") : null,
        myTeam ? h("p.muted", myTeam.name + " is " + RO.ordinal(myTeam.rank) + " of " + board.teams.length + " teams") : null
      ),
      top.length ? h("div.ranks", top.map(function (r) {
        return h("div.rank" + (r.uid === be.uid ? ".me" : ""), { style: "font-size:18px" },
          h("span.pos", String(r.rank)), h("span.who", r.name), h("span.delta", ""), h("span.pts", RO.fmtScore(r.score)));
      })) : null,
      final ? h("button.btn.quiet", { type: "button", onclick: function () { leave(""); } }, "Leave game") : null,
    ]);
  }

  /* ---------- Render ---------- */
  function render(force) {
    if (!me) {
      sceneKey = "";
      return RO.mount(root, lobbyInfo ? viewName() : viewCode());
    }
    // Skip rebuilds that would change nothing, so a selection is never interrupted mid-tap.
    const key = G ? [G.phase, G.qIndex, Q ? Q.n : -1, board ? board.qIndex : -1, G.qIndex >= 0 ? myAnswer(G.qIndex) : -1].join("|") : "none";
    if (!force && key === sceneKey) return;
    sceneKey = key;
    RO.mount(root, viewGame());
    tick();
  }
  function tick() {
    if (!G || G.phase !== "question" || !Q) return;
    const fill = document.getElementById("p-fill");
    if (!fill) return;
    const start = (G.starts || {})[G.qIndex];
    if (!start) return;
    const leftMs = start + Q.seconds * 1000 - be.now();
    fill.style.width = Math.max(0, Math.min(100, (leftMs / (Q.seconds * 1000)) * 100)) + "%";
    document.getElementById("p-secs").textContent = Math.max(0, Math.ceil(leftMs / 1000)) + " s";
  }

  async function boot() {
    RO.mount(root, h("div.center", { style: "min-height:60vh" }, h("p.muted", "Loading…")));
    try {
      be = await RO.createBackend();
    } catch (e) {
      RO.mount(root, h("div.phone", h("div.phone-body", h("div.notice", h("strong", "Could not connect. "), "Check your internet connection and reload."))));
      return;
    }
    const fromLink = (new URLSearchParams(location.search).get("code") || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    let saved = null;
    try {
      saved = JSON.parse(lsGet(SESSION_KEY) || "null");
    } catch (e) {}
    if (saved && saved.code && (!fromLink || fromLink === saved.code)) {
      // Returning after a reload or a locked phone: pick up where this player left off.
      try {
        const mine = await be.getDoc("games/" + saved.code + "/players/" + be.uid);
        const g = await be.getDoc("games/" + saved.code);
        if (mine && g) {
          code = saved.code;
          me = { name: mine.name, team: mine.team || "" };
          attach();
        }
      } catch (e) {}
    }
    if (!me && fromLink) await findGame(fromLink);
    RO.keepAwake();
    setInterval(tick, 200);
    render();
  }
  boot();
})();

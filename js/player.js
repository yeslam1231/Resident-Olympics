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
  let takenTeams = []; // teams that already have a device, as seen when this phone looked up the game
  let chosenTeam = ""; // team picked in the join form
  let confirmTeam = ""; // team the player has been warned is already connected
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
    // In a team game the row belongs to the team, whichever device answered.
    return board && board.rows ? board.rows.find(function (r) { return r.uid === be.uid || (r.uids || []).indexOf(be.uid) >= 0; }) : null;
  }

  function frame(body) {
    return h("div.phone",
      h("header.phone-head",
        h("img.logo", { src: "assets/gscs-logo.png", alt: "Gulf Society for Cardiac Surgery", style: "height:32px" }),
        h("div.brand", { style: "font-size:16px" }, "Resident ", h("b", "Olympics")),
        me ? h("div.me", me.name) : null
      ),
      h("main.phone-body", body)
    );
  }

  // The joining screens: logo and title over the conference ribbon, the form in a card.
  function welcome(title, card) {
    return h("div.phone",
      h("main.phone-body.ribbon",
        h("div.welcome",
          h("img.logo", { src: "assets/gscs-logo.png", alt: "Gulf Society for Cardiac Surgery" }),
          h("p.kicker", "Gulf Society for Cardiac Surgery"),
          title,
          h("div.card", card)
        )
      )
    );
  }

  /* ---------- Joining ---------- */
  function viewCode() {
    return welcome(h("h1", "Resident ", h("b", "Olympics")), [
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
        confirmTeam = "";
        takenTeams = (g.teams || []).length ? await teamsInUse(c) : [];
      }
    } catch (e) {
      note = "Could not reach the game. Check your connection and try again.";
    }
    render();
  }
  async function teamsInUse(c) {
    try {
      return (await be.getCol("games/" + c + "/players")).filter(function (p) { return p.id !== be.uid; }).map(function (p) { return p.team; }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }
  function viewName() {
    const teams = lobbyInfo.teams || [];
    return welcome(h("h1", lobbyInfo.title || "Resident Olympics"), [
      note ? h("div.notice", note) : null,
      h("form", { style: "display:flex;flex-direction:column;gap:16px", onsubmit: function (e) {
        e.preventDefault();
        if (teams.length) joinTeam(document.getElementById("team").value);
        else join(document.getElementById("name").value, "");
      } },
        teams.length
          // Team game: one device per team, so the team name is the player.
          ? [h("label.field", h("span", "Your team (one device per team)"),
              h("select", { id: "team", onchange: function (e) { chosenTeam = e.target.value; confirmTeam = takenTeams.indexOf(chosenTeam) >= 0 ? chosenTeam : ""; note = ""; render(); } },
                h("option", { value: "" }, "Choose your team…"), teams.map(function (t) {
                  return h("option", { value: t, selected: t === chosenTeam }, t + (takenTeams.indexOf(t) >= 0 ? " (already connected)" : ""));
                }))),
              confirmTeam
                ? h("label.field", h("span", "Organizer password to replace this team's device"),
                    h("input", { type: "password", id: "takeover-pass", autocomplete: "off" }))
                : null]
          : h("label.field", h("span", "Your name"),
              h("input", { type: "text", id: "name", maxlength: 24, autocomplete: "name", placeholder: "Dr. Al-Harbi", value: "" })),
        h("button.btn.primary.big", { type: "submit", disabled: sending }, confirmTeam ? "Replace the device for " + confirmTeam : "Join"),
        h("button.btn.quiet", { type: "button", onclick: function () { lobbyInfo = null; note = ""; confirmTeam = ""; render(); } }, "Use a different code")
      ),
    ]);
  }
  async function joinTeam(team) {
    if (!team) {
      note = "Choose your team.";
      return render();
    }
    takenTeams = await teamsInUse(code);
    if (takenTeams.indexOf(team) < 0) return join(team, team, false);
    // Only one device per team. Replacing it needs the organizer's password.
    const field = document.getElementById("takeover-pass");
    if (confirmTeam !== team || !field) {
      chosenTeam = team;
      confirmTeam = team;
      note = team + " is already playing on another device. Only one device per team is allowed. If that device has a problem, ask an organizer to enter the password here.";
      return render();
    }
    if (!(await RO.checkTakeover(field.value))) {
      note = "That password is not correct. Ask an organizer.";
      return render();
    }
    return join(team, team, true);
  }
  async function join(name, team, takeover) {
    name = String(name || "").trim().replace(/\s+/g, " ").slice(0, 24);
    if (!name) {
      note = "Enter a name so the scoreboard can show you.";
      return render();
    }
    sending = true;
    try {
      await be.setDoc("games/" + code + "/players/" + be.uid, { name: name, team: team || "", takeover: !!takeover, joinedAt: be.TS }, { calibrate: "joinedAt" });
      me = { name: name, team: team || "" };
      lsSet(SESSION_KEY, JSON.stringify({ code: code, name: me.name, team: me.team }));
      note = "";
      confirmTeam = "";
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
      else if (seenSelf) leave(me && me.team ? "This team is now playing on another device. Only one device per team can play." : "You were removed from the game. You can join again.");
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
      await be.setDoc("games/" + code + "/answers/" + n + "_" + be.uid, { q: n, uid: be.uid, choice: picked.i, team: me.team || "", at: be.TS }, { createOnly: true });
      lsSet("ro-ans-" + code + "-" + n + "-" + be.uid, String(picked.i));
    } catch (e) {
      RO.toast("That answer did not get through. Time may be up.", "bad");
    }
    sending = false;
    render(true);
  }

  function multiBadge(points) {
    return h("span.multi", { role: "img", "aria-label": (points === 2 ? "Double" : points + " times") + " points" }, h("b", "×" + points), h("small", "points"));
  }
  function questionCard(mine, open) {
    return [
      h("div.row", h("span.label", "Question " + (G.qIndex + 1) + " of " + G.qCount),
        Q.points > 1 ? multiBadge(Q.points) : null,
        h("span.grow"),
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
      return welcome(h("h1", "You're in, ", h("b", me.name)), [
        h("p", "Watch the big screen. The first question appears here when the host starts."),
        h("p.muted", G.scoring === "speed" ? "Correct answers score more the faster you lock in." : "Each correct answer scores. Speed only breaks ties."),
      ]);
    }
    if ((G.phase === "question" || G.phase === "reveal") && (!Q || Q.n !== n)) {
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
    if (G.phase === "reveal" && G.reveal) {
      // Result and standing together, as on the big screen.
      const ok = mine === G.reveal.correct;
      const fresh = row && board.qIndex === n;
      return frame([
        h("div.center.result" + (ok ? ".ok" : ".no"),
          Q.points > 1 ? multiBadge(Q.points) : null,
          h("div.verdict" + (ok ? ".ok" : ".no"), mine < 0 ? "No answer" : ok ? "Correct" : "Wrong"),
          ok && fresh ? h("div.bigstat", "+" + RO.fmtScore(row.delta)) : null,
          h("p", "Answer: ", h("b", RO.LETTERS[G.reveal.correct] + ". " + (Q.options[G.reveal.correct] || ""))),
          G.reveal.explanation ? h("p.muted", G.reveal.explanation) : null
        ),
        fresh ? h("div.standing",
          h("span.label", "Your standing"),
          h("div.row", { style: "justify-content:center;align-items:baseline;gap:14px" },
            h("span.bigstat", { style: "font-size:44px" }, RO.ordinal(row.rank)),
            h("span", h("b", RO.fmtScore(row.score)), " points · " + row.right + " correct"))
        ) : null,
      ]);
    }
    // final
    const rows = board && board.rows ? board.rows : [];
    const order = [rows[1], rows[0], rows[2]];
    return frame([
      h("h1", "Final result"),
      rows.length ? h("div.podium", order.map(function (r, i) {
        const place = [2, 1, 3][i];
        return h("div.step.s" + place, r ? [h("div.who", r.name), h("div.pts", RO.fmtScore(r.score) + " pts")] : null, h("div.block", String(place)));
      })) : h("p.muted", "The result is on the big screen."),
      row ? h("div.notice", h("strong", "You finished " + RO.ordinal(row.rank) + ". "), RO.fmtScore(row.score) + " points, " + row.right + " correct.") : null,
      h("button.btn.quiet", { type: "button", onclick: function () { leave(""); } }, "Leave game"),
    ]);
  }

  /* ---------- Render ---------- */
  function render(force) {
    // Double-point questions switch the phone to the red theme too.
    document.body.classList.toggle("double", !!(me && G && Q && Q.n === G.qIndex && Q.points > 1 && (G.phase === "question" || G.phase === "reveal")));
    if (!me) {
      sceneKey = "";
      return RO.mount(root, lobbyInfo ? viewName() : viewCode());
    }
    // Skip rebuilds that would change nothing, so a selection is never interrupted mid-tap.
    const key = G ? [G.phase, G.qIndex, Q ? Q.n : -1, board ? board.qIndex + ":" + (board.count || 0) : -1, G.qIndex >= 0 ? myAnswer(G.qIndex) : -1].join("|") : "none";
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

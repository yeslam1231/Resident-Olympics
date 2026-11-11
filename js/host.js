/* Resident Olympics — host: build the quiz, run the game on the big screen. */
(function () {
  "use strict";
  const RO = window.RO;
  const h = RO.h;
  const root = document.getElementById("app");
  const HOST_GAME_KEY = "ro-host-game";
  const SETUP_KEY = "ro-host-setup";

  let be = null;
  let quiz = RO.normalizeQuiz({});
  let view = "questions"; // questions | edit | setup | stage
  let draft = null; // question being edited
  let draftIsNew = false;
  let setup = { scoring: "speed", teams: [] };
  let code = null;
  let G = null; // live game document
  let P = []; // players
  let A = []; // answers
  let unsubs = [];
  let stageKey = "";
  let boardTab = "players";
  let locking = false;
  let busy = false;
  let armed = ""; // which two-step button is waiting for its second press

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
  function fail(e) {
    console.error(e);
    RO.toast(e && e.message ? e.message : "Something went wrong.", "bad");
  }
  function persistQuiz() {
    RO.saveQuiz(quiz).catch(function () {
      RO.toast("This browser would not save the quiz. Export it to a file before closing.", "bad");
    });
  }
  function joinUrl() {
    return new URL(".", location.href).href + "?code=" + code;
  }
  function shortUrl() {
    return new URL(".", location.href).href.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
  // A button that asks once more before doing something that cannot be undone.
  function twoStep(id, label, confirmLabel, cls, fn) {
    const on = armed === id;
    return h("button." + cls.split(" ").join("."), {
      type: "button",
      onclick: function () {
        if (on) {
          armed = "";
          fn();
        } else {
          armed = id;
          render(true);
          setTimeout(function () {
            if (armed === id) {
              armed = "";
              render(true);
            }
          }, 4000);
        }
      },
    }, on ? confirmLabel : label);
  }

  /* ================= Shell ================= */
  function shell(content) {
    function tab(id, label) {
      return h("button.tab", {
        type: "button",
        "aria-current": String(view === id || (id === "questions" && view === "edit")),
        onclick: function () {
          view = id;
          render();
        },
      }, label);
    }
    return h("div.shell",
      h("header.topbar",
        h("div.brand", "Resident ", h("b", "Olympics")),
        h("span.label", "Host"),
        h("div.spacer"),
        h("nav.tabs", tab("questions", "Questions"), tab("setup", "Run a game"))
      ),
      h("main.main",
        be.mode === "demo"
          ? h("div.notice", h("strong", "Demo mode. "), "Players can only join from other tabs of this browser. Add your Firebase config to config.js to play across phones (see README).")
          : null,
        content
      )
    );
  }

  /* ================= Questions ================= */
  function viewQuestions() {
    const fileIn = h("input", { type: "file", accept: "application/json,.json", hidden: true, id: "import-file", onchange: importQuiz });
    const list = quiz.questions.map(function (q, i) {
      const problem = RO.questionProblem(q);
      return h("div.qrow",
        h("div.n", String(i + 1)),
        h("div.thumb", { style: q.image ? "background-image:url('" + q.image.replace(/'/g, "%27") + "')" : "" }),
        h("div.t",
          h("p", q.text || "(image only)"),
          problem
            ? h("small.warn", "This question " + problem)
            : h("small", RO.LETTERS[q.correct] + " correct · " + q.options.length + " choices · " + q.seconds + " s" + (q.points > 1 ? " · ×" + q.points + " points" : ""))
        ),
        h("div.acts",
          h("button.btn.small.quiet", { type: "button", "aria-label": "Move up", disabled: i === 0, onclick: function () { move(i, -1); } }, "↑"),
          h("button.btn.small.quiet", { type: "button", "aria-label": "Move down", disabled: i === quiz.questions.length - 1, onclick: function () { move(i, 1); } }, "↓"),
          h("button.btn.small", { type: "button", onclick: function () { draft = JSON.parse(JSON.stringify(q)); draftIsNew = false; view = "edit"; render(); } }, "Edit")
        )
      );
    });
    return shell([
      h("div.row",
        h("label.field.grow", h("span", "Game title"),
          h("input", { type: "text", id: "quiz-title", value: quiz.title, maxlength: 80, onchange: function (e) { quiz.title = e.target.value.trim() || "Resident Olympics"; persistQuiz(); } })
        )
      ),
      h("div.row",
        h("h2.grow", { style: "font-size:30px" }, quiz.questions.length + (quiz.questions.length === 1 ? " question" : " questions")),
        fileIn,
        h("button.btn.small.quiet", { type: "button", onclick: function () { fileIn.click(); } }, "Import file"),
        h("button.btn.small.quiet", { type: "button", disabled: !quiz.questions.length, onclick: exportQuiz }, "Export file"),
        h("button.btn.primary", { type: "button", onclick: function () { draft = RO.blankQuestion(); draftIsNew = true; view = "edit"; render(); } }, "Add question")
      ),
      quiz.questions.length
        ? h("div.qlist", list)
        : h("div.empty",
            h("p", "No questions yet. Add your first one, import a quiz file, or load five sample questions to see how a round plays."),
            h("button.btn", { type: "button", onclick: function () { quiz = RO.sampleQuiz(); persistQuiz(); render(); } }, "Load sample questions")
          ),
      h("p.muted", { style: "font-size:15px" }, "Questions are saved in this browser on this device. Export a file to back them up or to move them to the laptop you will present from."),
    ]);
  }
  function move(i, d) {
    const qs = quiz.questions;
    const t = qs[i];
    qs[i] = qs[i + d];
    qs[i + d] = t;
    persistQuiz();
    render();
  }
  function exportQuiz() {
    const blob = new Blob([JSON.stringify(quiz, null, 1)], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: (quiz.title || "quiz").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() + ".json" });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function importQuiz(e) {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then(function (text) {
      const next = RO.normalizeQuiz(JSON.parse(text));
      if (!next.questions.length) throw new Error("That file has no questions in it.");
      quiz = next;
      persistQuiz();
      render();
      RO.toast("Imported " + next.questions.length + " questions.");
    }).catch(function (err) {
      fail(err instanceof SyntaxError ? new Error("That file is not a Resident Olympics quiz file.") : err);
    });
  }

  /* ---------- One question ---------- */
  function viewEdit() {
    const q = draft;
    const imgIn = h("input", { type: "file", accept: "image/*", hidden: true, id: "q-image-file", onchange: function (e) {
      const f = e.target.files[0];
      if (!f) return;
      RO.imageFileToDataURL(f, 1600, 700000).then(function (url) { q.image = url; render(); }).catch(fail);
    } });
    const opts = q.options.map(function (o, i) {
      return h("div.optedit", { "data-i": i },
        h("input", { type: "radio", name: "correct", id: "q-correct-" + i, checked: q.correct === i, "aria-label": "Mark " + RO.LETTERS[i] + " as the correct answer", onchange: function () { q.correct = i; } }),
        h("div.row", { style: "flex-wrap:nowrap" },
          h("span.chip", { "data-i": i }, RO.LETTERS[i]),
          h("input.grow", { type: "text", id: "q-opt-" + i, value: o, placeholder: "Answer choice " + RO.LETTERS[i], maxlength: 200, oninput: function (e) { q.options[i] = e.target.value; } })
        ),
        h("button.btn.small.quiet", { type: "button", "aria-label": "Remove choice " + RO.LETTERS[i], disabled: q.options.length <= 2, onclick: function () {
          q.options.splice(i, 1);
          if (q.correct >= q.options.length) q.correct = 0;
          else if (q.correct > i) q.correct -= 1;
          render();
        } }, "✕")
      );
    });
    return shell(
      h("form.panel", { onsubmit: function (e) { e.preventDefault(); saveDraft(); } },
        h("h2", draftIsNew ? "New question" : "Edit question"),
        h("label.field", h("span", "Question"),
          h("textarea", { id: "q-text", placeholder: "A 62-year-old man, day 2 after CABG…", maxlength: 600, oninput: function (e) { q.text = e.target.value; } }, q.text)
        ),
        h("div.field", h("span", "Image (echo still, angiogram, CT, ECG, operative photo)"),
          h("div.imgbox",
            q.image ? h("img", { src: q.image, alt: "Question image" }) : null,
            imgIn,
            h("button.btn.small", { type: "button", onclick: function () { imgIn.click(); } }, q.image ? "Replace image" : "Choose image"),
            q.image ? h("button.btn.small.quiet", { type: "button", onclick: function () { q.image = ""; render(); } }, "Remove image") : null
          )
        ),
        h("div.field", h("span", "Answer choices — select the correct one"),
          opts,
          h("div.row", h("button.btn.small.quiet", { type: "button", disabled: q.options.length >= RO.MAX_OPTIONS, onclick: function () { q.options.push(""); render(); } }, "Add a choice"))
        ),
        h("div.grid-2",
          h("label.field", h("span", "Time to answer (seconds)"),
            h("input", { type: "number", id: "q-seconds", min: 5, max: 600, value: q.seconds, oninput: function (e) { q.seconds = Number(e.target.value); } })),
          h("label.field", h("span", "Point value (1 = normal, 2 = double)"),
            h("input", { type: "number", id: "q-points", min: 1, max: 10, value: q.points, oninput: function (e) { q.points = Number(e.target.value); } }))
        ),
        h("label.field", h("span", "Explanation shown with the answer (optional)"),
          h("textarea", { id: "q-explain", maxlength: 400, style: "min-height:60px", oninput: function (e) { q.explanation = e.target.value; } }, q.explanation)
        ),
        h("div.row",
          draftIsNew ? null : twoStep("del-q", "Delete question", "Press again to delete", "btn danger", function () {
            quiz.questions = quiz.questions.filter(function (x) { return x.id !== q.id; });
            persistQuiz();
            view = "questions";
            render();
          }),
          h("div.grow"),
          h("button.btn.quiet", { type: "button", onclick: function () { view = "questions"; render(); } }, "Cancel"),
          h("button.btn.primary", { type: "submit" }, "Save question")
        )
      )
    );
  }
  function saveDraft() {
    const clean = RO.normalizeQuiz({ questions: [draft] }).questions[0];
    clean.options = clean.options.map(function (o) { return o.trim(); });
    const problem = RO.questionProblem(clean);
    if (problem) return RO.toast("This question " + problem + ".", "bad");
    const at = quiz.questions.findIndex(function (x) { return x.id === clean.id; });
    if (at >= 0) quiz.questions[at] = clean;
    else quiz.questions.push(clean);
    persistQuiz();
    view = "questions";
    render();
  }

  /* ================= Game setup ================= */
  function viewSetup() {
    if (code && G) {
      return shell(h("div.panel",
        h("h2", "A game is open: " + code),
        h("p.muted", "Go back to the big screen to continue it."),
        h("div.row", h("button.btn.primary", { type: "button", onclick: function () { view = "stage"; render(); } }, "Return to the game"))
      ));
    }
    const problems = quiz.questions.map(function (q, i) {
      const p = RO.questionProblem(q);
      return p ? "Question " + (i + 1) + " " + p : "";
    }).filter(Boolean);
    function scoringChoice(id, title, text) {
      return h("label",
        h("input", { type: "radio", name: "scoring", id: "scoring-" + id, checked: setup.scoring === id, onchange: function () { setup.scoring = id; saveSetup(); } }),
        h("span", h("b", title), h("small", text))
      );
    }
    return shell([
      h("div.panel",
        h("h2", "Scoring"),
        h("div.seg",
          scoringChoice("speed", "Correct plus speed", "Up to 1,000 points per question. A correct answer at the buzzer still earns 500."),
          scoringChoice("plain", "Correct answers only", "Each correct answer earns the question's point value. Ties go to the faster player.")
        )
      ),
      h("div.panel",
        h("h2", "Teams"),
        h("p.muted", "Leave this empty for an individual competition. With teams, every resident still answers on their own phone, picks a team when joining, and the team score is the average of its members. For one device per team, leave it empty and have each team join under its team name."),
        h("label.field", h("span", "Team names, one per line"),
          h("textarea", { id: "teams", placeholder: "Aorta\nMitral\nTricuspid", oninput: function (e) {
            setup.teams = Array.from(new Set(e.target.value.split("\n").map(function (s) { return s.trim().slice(0, 30); }).filter(Boolean))).slice(0, 20);
            saveSetup();
          } }, setup.teams.join("\n"))
        )
      ),
      problems.length ? h("div.notice", h("strong", "Fix before starting: "), problems.join("; ") + ".") : null,
      h("div.row.end",
        h("span.muted.grow", quiz.questions.length ? quiz.questions.length + " questions ready in “" + quiz.title + "”." : "Add questions first."),
        h("button.btn.primary.big", { type: "button", id: "open-lobby", disabled: !quiz.questions.length || problems.length > 0 || busy, onclick: openLobby }, "Open the lobby")
      ),
    ]);
  }
  function saveSetup() {
    lsSet(SETUP_KEY, JSON.stringify(setup));
  }

  async function openLobby() {
    busy = true;
    try {
      let c = "";
      for (let i = 0; i < 6; i++) {
        c = RO.gameCode();
        if (!(await be.getDoc("games/" + c))) break;
      }
      await be.setDoc("games/" + c, {
        hostUid: be.uid,
        title: quiz.title,
        scoring: setup.scoring,
        teams: setup.teams,
        phase: "lobby",
        qIndex: -1,
        qCount: quiz.questions.length,
        starts: {},
        reveal: null,
        createdAt: be.TS,
      }, { calibrate: "createdAt" });
      lsSet(HOST_GAME_KEY, c);
      attach(c);
      view = "stage";
    } catch (e) {
      fail(e);
    }
    busy = false;
    render();
  }

  function attach(c) {
    detach();
    code = c;
    const onErr = function (e) { fail(new Error("Lost the live connection: " + (e.code || e.message))); };
    unsubs.push(be.onDoc("games/" + c, function (d) { G = d; liveRender(); }, onErr));
    unsubs.push(be.onCol("games/" + c + "/players", function (list) { P = list; liveRender(); }, onErr));
    unsubs.push(be.onCol("games/" + c + "/answers", function (list) { A = list; liveRender(); }, onErr));
  }
  // Live updates must not rebuild the question editor while the host is typing in it.
  function liveRender() {
    if (view === "stage" || view === "setup") render();
  }
  function detach() {
    unsubs.forEach(function (u) { u(); });
    unsubs = [];
    code = null;
    G = null;
    P = [];
    A = [];
    stageKey = "";
  }

  /* ================= Running the game ================= */
  function patch(data) {
    return be.setDoc("games/" + code, data, { merge: true }).catch(fail);
  }
  async function startQuestion(n) {
    const q = quiz.questions[n];
    if (!q) return;
    locking = false;
    try {
      await be.setDoc("games/" + code + "/questions/" + n, { n: n, text: q.text, image: q.image, options: q.options, seconds: q.seconds, points: q.points });
      const starts = {};
      starts[n] = be.TS;
      await be.setDoc("games/" + code, { phase: "question", qIndex: n, reveal: null, starts: starts }, { merge: true });
    } catch (e) {
      fail(e);
    }
  }
  function lockQuestion() {
    if (locking) return;
    locking = true;
    patch({ phase: "locked" });
  }
  function keys() {
    return quiz.questions.map(function (q) { return { correct: q.correct, seconds: q.seconds, points: q.points }; });
  }
  function revealedUpto() {
    return G.phase === "reveal" || G.phase === "board" || G.phase === "final" ? G.qIndex : G.qIndex - 1;
  }
  function standings() {
    return RO.computeBoard(P, A, keys(), G.starts || {}, revealedUpto(), G.scoring);
  }
  async function reveal() {
    const q = quiz.questions[G.qIndex];
    const counts = q.options.map(function () { return 0; });
    A.forEach(function (a) {
      if (a.q === G.qIndex && a.choice >= 0 && a.choice < counts.length) counts[a.choice] += 1;
    });
    const b = RO.computeBoard(P, A, keys(), G.starts || {}, G.qIndex, G.scoring);
    try {
      await be.setDoc("games/" + code + "/meta/board", { qIndex: G.qIndex, rows: b.rows, teams: b.teams });
      await be.setDoc("games/" + code, { phase: "reveal", reveal: { correct: q.correct, counts: counts, explanation: q.explanation } }, { merge: true });
    } catch (e) {
      fail(e);
    }
  }
  function advance() {
    if (G.qIndex + 1 < Math.min(G.qCount, quiz.questions.length)) startQuestion(G.qIndex + 1);
    else patch({ phase: "final" });
  }
  function closeGame() {
    lsSet(HOST_GAME_KEY, null);
    detach();
    view = "setup";
    render();
  }
  function downloadResults() {
    const b = standings();
    const esc = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    const lines = ["Rank,Name,Team,Score,Correct answers"];
    b.rows.forEach(function (r) { lines.push([r.rank, esc(r.name), esc(r.team), r.score, r.right].join(",")); });
    if (b.teams.length) {
      lines.push("", "Team rank,Team,Members,Average score");
      b.teams.forEach(function (t) { lines.push([t.rank, esc(t.name), t.members, t.score].join(",")); });
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "resident-olympics-results-" + code + ".csv" });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /* ---------- Stage pieces ---------- */
  function stageHead(where) {
    return h("header.stage-head",
      h("div.where", where),
      h("div.join", "Join at ", h("span", shortUrl()), " · code ", h("b", code)),
      h("div.spacer", { style: "flex:1" }),
      h("button.btn.small.quiet", { type: "button", onclick: function () { view = "questions"; render(); } }, "Exit to editor"),
      h("button.btn.small.quiet", { type: "button", onclick: function () {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(function () {});
      } }, "Full screen")
    );
  }
  function optionList(q, rev) {
    const total = rev ? Math.max(1, rev.counts.reduce(function (a, b) { return a + b; }, 0)) : 1;
    return h("div.opts", q.options.map(function (o, i) {
      return h("div.opt" + (rev ? (i === rev.correct ? ".right" : ".wrong") : ""), { "data-i": i },
        rev ? h("span.bar", { style: "width:" + Math.round((rev.counts[i] / total) * 100) + "%" }) : null,
        h("span.chip", { "data-i": i, style: "position:relative" }, RO.LETTERS[i]),
        h("span.txt", o),
        rev ? h("span.cnt.num", String(rev.counts[i])) : null
      );
    }));
  }
  function answeredCount() {
    const ids = new Set(P.map(function (p) { return p.id; }));
    return A.filter(function (a) { return a.q === G.qIndex && ids.has(a.uid); }).length;
  }
  function rankRows(list, limit, isTeam) {
    return h("div.ranks", list.slice(0, limit).map(function (r) {
      return h("div.rank" + (r.rank === 1 && r.score > 0 ? ".p1" : ""),
        h("span.pos", String(r.rank)),
        h("span.who", r.name, isTeam ? h("small", r.members + (r.members === 1 ? " member" : " members")) : (r.team ? h("small", r.team) : null)),
        h("span.delta", !isTeam && r.delta ? "+" + RO.fmtScore(r.delta) : ""),
        h("span.pts", RO.fmtScore(r.score))
      );
    }));
  }
  function tabSwitch() {
    if (!G.teams || !G.teams.length) return null;
    function b(id, label) {
      return h("button.tab", { type: "button", "aria-current": String(boardTab === id), onclick: function () { boardTab = id; render(true); } }, label);
    }
    return h("nav.tabs", b("teams", "Teams"), b("players", "Players"));
  }
  function rosterNames() {
    const sorted = P.slice().sort(function (a, b) { return (a.joinedAt || 0) - (b.joinedAt || 0); });
    return sorted.map(function (p) {
      return h("span.name", p.name, p.team ? h("small", p.team) : null,
        h("button", { type: "button", "aria-label": "Remove " + p.name, title: "Remove", onclick: function () { be.deleteDoc("games/" + code + "/players/" + p.id).catch(fail); } }, "✕"));
    });
  }

  function viewStage() {
    if (!G) return h("div.stage", h("div.stage-body", h("div.center", h("p.muted", "Connecting to the game…"))));
    const n = G.qIndex;
    const q = quiz.questions[n];
    const missing = (G.phase === "question" || G.phase === "locked" || G.phase === "reveal") && !q;
    if (missing) {
      return h("div.stage", stageHead("Game " + code), h("div.stage-body", h("div.center",
        h("p", "This game's questions are not on this device. Import the same quiz file, or close the game."),
        h("div.row", h("button.btn", { type: "button", onclick: function () { view = "questions"; render(); } }, "Go to questions"),
          twoStep("close", "Close game", "Press again to close", "btn danger", closeGame)))));
    }

    if (G.phase === "lobby") {
      const canvas = h("canvas", { "aria-label": "QR code to join" });
      drawQr(canvas, joinUrl());
      return h("div.stage",
        stageHead(G.title),
        h("div.stage-body",
          h("div.lobby",
            h("div.joincard",
              h("h1", "Join the game"),
              h("p.url", "Scan, or open ", h("b", shortUrl()), " and enter"),
              h("div.code", code),
              canvas
            ),
            h("div.roster",
              h("h2", { id: "roster-title" }, rosterTitle()),
              h("div.names", { id: "roster" }, rosterNames())
            )
          )
        ),
        h("footer.stage-foot",
          h("span.status.grow", G.scoring === "speed" ? "Scoring: correct plus speed" : "Scoring: correct answers only", G.teams.length ? " · " + G.teams.length + " teams" : ""),
          twoStep("close", "Cancel game", "Press again to cancel", "btn small danger", closeGame),
          h("button.btn.primary.big", { type: "button", id: "start-game", disabled: !P.length, onclick: function () { startQuestion(0); } }, "Start · " + G.qCount + " questions")
        )
      );
    }

    if (G.phase === "question" || G.phase === "locked" || G.phase === "reveal") {
      const rev = G.phase === "reveal" ? G.reveal : null;
      let foot;
      if (G.phase === "question") {
        foot = [
          h("span.status", { id: "answered" }, answeredText()),
          h("div.clock.grow", { id: "clock" }, h("div.trace", h("i", { id: "clock-fill", style: "width:100%" })), h("div.secs", { id: "clock-secs" }, String(q.seconds))),
          h("button.btn", { type: "button", id: "lock-now", onclick: lockQuestion }, "Stop the clock"),
        ];
      } else if (G.phase === "locked") {
        foot = [
          h("span.status.grow", { id: "answered" }, h("b", "Time. "), answeredText()),
          h("button.btn.primary.big", { type: "button", id: "reveal", onclick: reveal }, "Reveal answer"),
        ];
      } else {
        foot = [
          h("span.status.grow", h("b", RO.LETTERS[rev.correct] + " is correct. "), rightCount(rev) ),
          h("button.btn.primary.big", { type: "button", id: "show-board", onclick: function () { patch({ phase: "board" }); } }, "Scoreboard"),
        ];
      }
      return h("div.stage",
        stageHead("Question " + (n + 1) + " of " + G.qCount + (q.points > 1 ? " · ×" + q.points : "")),
        h("div.stage-body",
          q.text ? h("h1.q-text", q.text) : null,
          h("div.q-split" + (q.image ? ".has-img" : ""),
            q.image ? h("div.q-media", h("img", { src: q.image, alt: "Question image" })) : null,
            h("div", { style: "display:flex;flex-direction:column;gap:14px;min-height:0;justify-content:center" },
              optionList(q, rev),
              rev && rev.explanation ? h("p.explain", rev.explanation) : null
            )
          )
        ),
        h("footer.stage-foot", foot)
      );
    }

    // board / final
    const b = standings();
    const showTeams = G.teams.length && boardTab === "teams";
    const list = showTeams ? b.teams : b.rows;
    const last = G.qIndex + 1 >= G.qCount;
    if (G.phase === "final") {
      const top = list.slice(0, 3);
      const order = [top[1], top[0], top[2]];
      return h("div.stage",
        stageHead("Final result"),
        h("div.stage-body",
          h("div.board",
            h("div.row", h("h1.grow", showTeams ? "Winning teams" : "Champions"), tabSwitch()),
            h("div.podium", order.map(function (r, i) {
              const place = [2, 1, 3][i];
              return h("div.step.s" + place, r ? [h("div.who", r.name), h("div.pts", RO.fmtScore(r.score) + " pts")] : null, h("div.block", String(place)));
            })),
            list.length > 3 ? rankRows(list.slice(3), 50, showTeams) : null
          )
        ),
        h("footer.stage-foot",
          h("span.status.grow", P.length + " players · " + G.qCount + " questions"),
          h("button.btn", { type: "button", onclick: downloadResults }, "Download results"),
          twoStep("close", "Close game", "Press again to close", "btn danger", closeGame)
        )
      );
    }
    return h("div.stage",
      stageHead("After question " + (n + 1) + " of " + G.qCount),
      h("div.stage-body",
        h("div.board",
          h("div.row", h("h1.grow", "Scoreboard"), tabSwitch()),
          rankRows(list, 8, showTeams)
        )
      ),
      h("footer.stage-foot",
        h("span.status.grow", list.length > 8 ? "Top 8 of " + list.length : ""),
        twoStep("finish", "End game now", "Press again to end", "btn small quiet", function () { patch({ phase: "final" }); }),
        h("button.btn.primary.big", { type: "button", id: "next", onclick: advance }, last ? "Final result" : "Next question")
      )
    );
  }
  function rosterTitle() {
    return P.length ? P.length + (P.length === 1 ? " player in" : " players in") : "Waiting for players";
  }
  function answeredText() {
    return answeredCount() + " of " + P.length + " answered";
  }
  function rightCount(rev) {
    const total = rev.counts.reduce(function (a, b) { return a + b; }, 0);
    return rev.counts[rev.correct] + " of " + total + " answers were right.";
  }
  function drawQr(canvas, text) {
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      const cell = 8;
      canvas.width = canvas.height = n * cell;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#000";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
    } catch (e) {
      canvas.hidden = true;
    }
  }

  /* ================= Render loop ================= */
  function render(force) {
    if (view === "stage") {
      // Player and answer updates arrive constantly; only rebuild the stage when the scene changes.
      const key = G ? [G.phase, G.qIndex, boardTab, armed, code].join("|") : "none";
      if (!force && key === stageKey && G) {
        const a = document.getElementById("answered");
        if (a && G.phase === "question") a.textContent = answeredText();
        const r = document.getElementById("roster");
        if (r) {
          r.replaceChildren.apply(r, rosterNames());
          document.getElementById("roster-title").textContent = rosterTitle();
          const s = document.getElementById("start-game");
          if (s) s.disabled = !P.length;
        }
        if (G.phase === "board" || G.phase === "final") RO.mount(root, viewStage());
        return;
      }
      stageKey = key;
      RO.mount(root, viewStage());
      tick();
      return;
    }
    stageKey = "";
    RO.mount(root, view === "edit" ? viewEdit() : view === "setup" ? viewSetup() : viewQuestions());
  }

  function tick() {
    if (view !== "stage" || !G || G.phase !== "question") return;
    const q = quiz.questions[G.qIndex];
    const start = (G.starts || {})[G.qIndex];
    if (!q || !start) return;
    const leftMs = start + q.seconds * 1000 - be.now();
    const fill = document.getElementById("clock-fill");
    if (!fill) return;
    fill.style.width = Math.max(0, Math.min(100, (leftMs / (q.seconds * 1000)) * 100)) + "%";
    document.getElementById("clock-secs").textContent = String(Math.max(0, Math.ceil(leftMs / 1000)));
    document.getElementById("clock").classList.toggle("low", leftMs <= 5000);
    // A short grace period lets answers tapped at the buzzer arrive.
    if (leftMs <= -600) lockQuestion();
  }

  async function boot() {
    RO.mount(root, h("div.center", { style: "min-height:60vh" }, h("p.muted", "Loading…")));
    try {
      be = await RO.createBackend();
    } catch (e) {
      RO.mount(root, h("div.main", h("div.notice", h("strong", "Could not connect. "), (e && e.message) || "", " Check config.js and your Firebase project (see README).")));
      return;
    }
    try {
      setup = Object.assign(setup, JSON.parse(lsGet(SETUP_KEY) || "{}"));
      if (!Array.isArray(setup.teams)) setup.teams = [];
    } catch (e) {}
    quiz = (await RO.loadQuiz()) || quiz;
    const saved = lsGet(HOST_GAME_KEY);
    if (saved) {
      try {
        const g = await be.getDoc("games/" + saved);
        if (g && g.hostUid === be.uid) {
          attach(saved);
          view = "stage";
        } else {
          lsSet(HOST_GAME_KEY, null);
        }
      } catch (e) {
        lsSet(HOST_GAME_KEY, null);
      }
    }
    RO.keepAwake();
    setInterval(tick, 200);
    render();
  }
  boot();
})();

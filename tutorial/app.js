// BeingDB browser tutorial. Loads the BeingDB WASM runtime and the REWIND
// export, then renders lessons from lessons/*.json. All query behaviour
// (parsing, validation, execution, diagnostics, plans) comes from BeingDB;
// this file and ui.js only display it.
(() => {
  const { h, rich, fill, ACTIONS, call, renderResponse, makeEditor, describeCard, predicateBrowser } = window.BeingDBUI;
  const F = window.TutorialFormat;
  const DATA_URL = "../web/rewind.browser.json";
  const DONE_KEY = "beingdb-tutorial-done";

  const state = { BeingDB: null, summary: null, predicates: [], lessons: [], index: 0 };
  const $ = (sel) => document.querySelector(sel);

  function blocks(list = []) {
    return list.map((b) => {
      if (typeof b === "string") return rich("p", b);
      if (b.list) return h("ul", b.list.map((item) => rich("li", item)));
      if (b.note) return h("aside.note", rich("p", b.note));
      if (b.code) return h("pre.code", b.code);
      if (b.table)
        return h(
          "div.table-wrap",
          h("table.prose", h("thead", h("tr", b.table.head.map((c) => rich("th", c)))), h("tbody", b.table.rows.map((r) => h("tr", r.map((c) => rich("td", c)))))),
        );
      return null;
    });
  }

  // ---- Steps ----------------------------------------------------------------

  function queryStep(step, lessonId) {
    const action = step.action || "execute";
    const editor = makeEditor(step.query);
    const out = h("div.output", { "aria-live": "polite" });
    const run = (a) => {
      renderResponse(out, call(state.BeingDB, a, editor.get()), editor);
      markDone(lessonId);
    };
    editor.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        run(action);
      }
    });
    const secondary = ["validate", "diagnose", "explain"].filter((a) => a !== action);
    const buttons = h(
      "div.toolbar",
      h("button.primary", { type: "button", onclick: () => run(action) }, ACTIONS[action].label),
      secondary.map((a) => h("button.secondary", { type: "button", onclick: () => run(a), title: `${ACTIONS[a].label} without running` }, ACTIONS[a].label)),
      h("button.ghost", { type: "button", onclick: () => { editor.set(step.query); out.replaceChildren(); } }, "Reset"),
      step.kind === "exercise" ? h("button.ghost", { type: "button", onclick: () => editor.set(step.solution) }, "Show solution") : null,
      h("span.hint", "Ctrl/⌘ + Enter"),
    );
    return [step.question ? h("p.question", h("span.label", step.kind === "exercise" ? "Exercise" : "Question"), rich("span", step.question)) : null, editor.el, buttons, out];
  }

  function describeStep(step) {
    const card = h("div");
    const select = h(
      "select",
      { "aria-label": "Predicate", onchange: () => card.replaceChildren(describeCard(byName(select.value))) },
      state.predicates.map((p) => h("option", { value: p.name, selected: p.name === step.predicate }, `${p.name}/${p.arity}`)),
    );
    card.append(describeCard(byName(step.predicate)));
    return [h("div.toolbar", h("label", "Describe ", select)), card];
  }

  const byName = (name) => state.predicates.find((p) => p.name === name);

  function renderStep(step, lessonId) {
    const kind = step.kind || "query";
    let body = [];
    if (kind === "query" || kind === "exercise") body = queryStep(step, lessonId);
    else if (kind === "describe") body = describeStep(step);
    else if (kind === "predicates") body = predicateBrowser(state.predicates);
    return h(
      "section.step",
      step.heading ? h("h3", step.heading) : null,
      body,
      blocks(step.notes),
      step.try && step.try.length ? h("aside.try", h("p.label", "Try changing…"), h("ul", step.try.map((t) => rich("li", t)))) : null,
    );
  }

  // ---- Lessons and navigation ----------------------------------------------

  const done = () => new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]"));
  function markDone(id) {
    const s = done();
    if (s.has(id)) return;
    s.add(id);
    localStorage.setItem(DONE_KEY, JSON.stringify([...s]));
    renderNav();
  }

  function renderNav() {
    const finished = done();
    fill(
      $("#nav"),
      state.lessons.map((l, i) =>
        h(
          "li",
          h("a", { href: `#${l.id}`, "aria-current": i === state.index ? "page" : false, class: finished.has(l.id) ? "done" : "" }, h("span.num", String(i + 1)), l.title),
        ),
      ),
    );
  }

  function show(index) {
    state.index = Math.max(0, Math.min(index, state.lessons.length - 1));
    const lesson = state.lessons[state.index];
    if (lesson.steps.every((s) => !["query", "exercise", undefined].includes(s.kind))) markDone(lesson.id);
    const prev = state.lessons[state.index - 1];
    const next = state.lessons[state.index + 1];
    fill(
      $("#lesson"),
      h("p.kicker", `Lesson ${state.index + 1} of ${state.lessons.length}`),
      h("h2", lesson.title),
      blocks(lesson.intro),
      lesson.steps.map((s) => renderStep(s, lesson.id)),
      h(
        "nav.pager",
        prev ? h("a.prev", { href: `#${prev.id}` }, `← ${prev.title}`) : h("span"),
        next ? h("a.next", { href: `#${next.id}` }, `${next.title} →`) : h("span"),
      ),
    );
    renderNav();
    document.title = `${lesson.title} · BeingDB tutorial`;
    window.scrollTo(0, 0);
  }

  function route() {
    const id = location.hash.slice(1);
    const i = state.lessons.findIndex((l) => l.id === id);
    show(i < 0 ? 0 : i);
  }

  function openVocabulary() {
    const dialog = $("#vocabulary");
    const body = dialog.querySelector(".dialog-body");
    if (!body.childElementCount) body.append(...predicateBrowser(state.predicates));
    dialog.showModal();
  }

  // ---- Boot -----------------------------------------------------------------

  function fail(message) {
    $("#status").textContent = "Failed to load";
    fill(
      $("#lesson"),
      h("div.message.error", h("div.message-head", h("code.badge", "load_failed")), h("p", message)),
      h("p", "Serve the build directory over HTTP (see tutorial/README.md); opening the file directly from disk does not work."),
    );
  }

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  window.onBeingDBReady = async (BeingDB) => {
    try {
      state.BeingDB = BeingDB;
      $("#status").textContent = "Loading REWIND data…";
      const [order, data] = await Promise.all([getJson("lessons/index.json"), fetch(DATA_URL).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${DATA_URL}: HTTP ${r.status}`))))]);
      state.lessons = await Promise.all(order.map(async (id) => ({ id, ...(await getJson(`lessons/${id}.json`)) })));
      const summary = F.parse(BeingDB.load(data));
      if (summary.error) throw new Error(summary.error.message);
      state.summary = summary;
      state.predicates = F.parse(BeingDB.predicates()).predicates || [];
      $("#status").textContent = `REWIND · ${summary.predicates} predicates · ${summary.facts.toLocaleString()} facts · running in your browser`;
      $("#vocab-button").disabled = false;
      $("#vocab-button").addEventListener("click", openVocabulary);
      window.addEventListener("hashchange", route);
      route();
    } catch (e) {
      fail(String(e && e.message ? e.message : e));
    }
  };

  window.addEventListener("error", (e) => {
    if (!state.BeingDB) fail(`Could not start the BeingDB WebAssembly runtime: ${e.message}`);
  });
})();

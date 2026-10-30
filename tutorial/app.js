// BeingDB browser tutorial. Loads the BeingDB WASM runtime and the REWIND
// export, then renders lessons from lessons/*.json. All query behaviour
// (parsing, validation, execution, diagnostics, plans) comes from BeingDB;
// this file only displays it.
(() => {
  const F = window.TutorialFormat;
  const DATA_URL = "../web/rewind.browser.json";
  const DONE_KEY = "beingdb-tutorial-done";

  const state = { BeingDB: null, summary: null, predicates: [], lessons: [], index: 0 };
  const $ = (sel) => document.querySelector(sel);

  // Tiny DOM builder: h("div.class", {attrs}, ...children). Strings become text nodes.
  function h(tag, attrs, ...children) {
    const [name, ...classes] = tag.split(".");
    const el = document.createElement(name);
    if (classes.length) el.className = classes.join(" ");
    if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs);
      attrs = null;
    }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  const rich = (tag, text) => h(tag, { html: F.inline(text) });
  // replaceChildren, accepting nested arrays like h() does.
  const fill = (el, ...children) => el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));

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

  // ---- Calling the runtime -------------------------------------------------

  const ACTIONS = {
    execute: { method: "query", label: "Run" },
    validate: { method: "validate", label: "Validate" },
    diagnose: { method: "diagnose", label: "Diagnose" },
    explain: { method: "explain", label: "Explain" },
  };

  function call(action, text) {
    const t = performance.now();
    let raw;
    try {
      raw = state.BeingDB[ACTIONS[action].method](text);
    } catch (e) {
      raw = JSON.stringify({ error: { code: "runtime_exception", message: String(e && e.message ? e.message : e) } });
    }
    const json = F.parse(raw);
    return { json, view: F.classify(json, action), ms: performance.now() - t };
  }

  // ---- Rendering responses -------------------------------------------------

  function messages(list, cls) {
    return list.map((m) =>
      h(
        `div.message.${cls}${m.severity ? "." + m.severity : ""}`,
        h("div.message-head", h("code.badge", m.code || cls), m.severity ? h("span.severity", m.severity) : null, m.line ? h("span.where", `line ${m.line}${m.column ? `, column ${m.column}` : ""}`) : null),
        h("p", m.message || ""),
        Array.isArray(m.suggestions) && m.suggestions.length ? h("p.suggest", "Did you mean: ", m.suggestions.map((s) => h("code", s)).reduce((a, b) => [a, ", ", b])) : null,
        m.groups ? h("p.suggest", "Unconnected groups: ", m.groups.map((g) => h("code", g.join(" ")))) : null,
      ),
    );
  }

  function diagnosis(view, editor) {
    const out = [];
    if (view.provablyEmpty) out.push(h("p.provably", h("strong", "Provably empty: "), "BeingDB has proved this query can never match the loaded data."));
    if (view.diagnostics.length) out.push(...messages(view.diagnostics, "diagnostic"));
    if (view.repair && view.repair.query)
      out.push(
        h(
          "div.repair",
          h("p", h("strong", "Proven repair"), " (computed by BeingDB):"),
          h("pre.code", view.repair.query),
          h("button.secondary", { type: "button", onclick: () => editor.set(view.repair.query) }, "Apply repair"),
        ),
      );
    return out;
  }

  function resultTable(view) {
    const LIMIT = 100;
    const table = (rows) =>
      h(
        "div.table-wrap",
        h(
          "table.results",
          h("thead", h("tr", view.variables.map((v) => h("th", v)))),
          h(
            "tbody",
            rows.map((row) =>
              h(
                "tr",
                row.map((v) => (v == null ? h("td.null", { title: "unbound (no optional match)" }, "null") : h("td", { title: v.type }, F.cellText(v)))),
              ),
            ),
          ),
        ),
      );
    const wrap = h("div", table(view.rows.slice(0, LIMIT)));
    if (view.rows.length > LIMIT)
      wrap.append(h("button.link", { type: "button", onclick: (e) => wrap.replaceChildren(table(view.rows)) }, `Show all ${view.rows.length} rows`));
    return wrap;
  }

  function summaryLine(view, ms) {
    const n = (x) => `${x} row${x === 1 ? "" : "s"}`;
    let text = view.count === view.total ? n(view.total) : `${n(view.count)} shown of ${view.total} matching`;
    if (view.truncated) text += " (truncated by the result cap)";
    return h("p.summary", text, h("span.ms", ` · ${ms.toFixed(1)} ms`));
  }

  function renderResponse(out, { json, view, ms }, editor) {
    const parts = [];
    if (view.kind === "rows") {
      parts.push(summaryLine(view, ms));
      if (view.rows.length) parts.push(resultTable(view));
      else parts.push(h("p.empty", "No rows."));
      parts.push(...diagnosis(view, editor));
    } else if (view.kind === "invalid") {
      parts.push(h("p.summary.bad", "Query rejected before running"));
      parts.push(...messages(view.errors, "error"));
    } else if (view.kind === "failure") {
      parts.push(h("p.summary.bad", "Query failed"));
      parts.push(...messages([{ code: view.code, message: view.message }], "error"));
    } else if (view.kind === "diagnose") {
      parts.push(h("p.summary", view.diagnostics.length ? "Diagnostics (query not executed)" : "No problems found (query not executed)", h("span.ms", ` · ${ms.toFixed(1)} ms`)));
      parts.push(...diagnosis(view, editor));
    } else if (view.kind === "validate") {
      parts.push(h("p.summary.good", "Valid. ", "Returns columns: ", view.projection.map((v) => h("code", v)).reduce((a, b) => [a, ", ", b], []), view.distinct ? " (distinct)" : ""));
    } else if (view.kind === "explain") {
      parts.push(h("p.summary", "Execution plan (query not executed)"));
      parts.push(h("pre.code", view.planText));
    }
    if (view.warnings && view.warnings.length) parts.push(...messages(view.warnings, "warning"));
    parts.push(h("details.raw", h("summary", "Raw JSON"), h("pre", JSON.stringify(json, null, 2))));
    fill(out, parts);
  }

  // ---- Steps ----------------------------------------------------------------

  function makeEditor(initial) {
    const area = h("textarea.editor", { spellcheck: "false", autocapitalize: "off", autocomplete: "off", "aria-label": "BeingDB query" });
    const fit = () => {
      area.style.height = "auto";
      area.style.height = `${area.scrollHeight + 2}px`;
    };
    area.value = initial;
    area.addEventListener("input", fit);
    area.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        area.setRangeText("  ", area.selectionStart, area.selectionEnd, "end");
        fit();
      }
    });
    requestAnimationFrame(fit);
    return {
      el: area,
      get: () => area.value,
      set: (text) => {
        area.value = text;
        fit();
        area.focus();
      },
    };
  }

  function queryStep(step, lessonId) {
    const action = step.action || "execute";
    const editor = makeEditor(step.query);
    const out = h("div.output", { "aria-live": "polite" });
    const run = (a) => {
      renderResponse(out, call(a, editor.get()), editor);
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

  function describeCard(p) {
    if (!p) return h("p.empty", "Unknown predicate.");
    const examples = (p.examples || []).map((args) => `${p.name}(${args.map(F.literal).join(", ")})`);
    return h(
      "div.describe",
      h("h4", h("code", `${p.name}/${p.arity}`), h("span.count", `${p.count} facts`)),
      p.description ? h("p", p.description) : h("p.empty", "No description declared."),
      h(
        "div.table-wrap",
        h(
          "table.prose",
          h("thead", h("tr", h("th", "Argument"), h("th", "Role"), h("th", "Type"))),
          h("tbody", p.arguments.map((a) => h("tr", h("td", String(a.position)), h("td", a.role ? h("code", a.role) : "–", a.semanticType ? ` (${a.semanticType})` : ""), h("td", a.types.join(" | "))))),
        ),
      ),
      examples.length ? [h("p.label", "Examples"), h("pre.code", examples.join("\n"))] : null,
    );
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

  function predicateBrowser(onPick) {
    const detail = h("div");
    const tbody = h("tbody");
    const filter = h("input.filter", { type: "search", placeholder: "Filter predicates, e.g. year", "aria-label": "Filter predicates" });
    const count = h("span.hint");
    const draw = () => {
      const q = filter.value.trim().toLowerCase();
      const shown = state.predicates.filter((p) => !q || p.name.includes(q) || (p.description || "").toLowerCase().includes(q));
      count.textContent = `${shown.length} of ${state.predicates.length}`;
      fill(
        tbody,
        shown.map((p) =>
          h(
            "tr",
            h("td", h("button.link", { type: "button", onclick: () => (onPick ? onPick(p) : detail.replaceChildren(describeCard(p))) }, `${p.name}/${p.arity}`)),
            h("td.num", String(p.count)),
            h("td", p.description || ""),
          ),
        ),
      );
    };
    filter.addEventListener("input", draw);
    draw();
    return [
      h("div.toolbar", filter, count),
      detail,
      h("div.table-wrap.scroll", h("table.prose.predicates", h("thead", h("tr", h("th", "Predicate"), h("th", "Facts"), h("th", "Description"))), tbody)),
    ];
  }

  const byName = (name) => state.predicates.find((p) => p.name === name);

  function renderStep(step, lessonId) {
    const kind = step.kind || "query";
    let body = [];
    if (kind === "query" || kind === "exercise") body = queryStep(step, lessonId);
    else if (kind === "describe") body = describeStep(step);
    else if (kind === "predicates") body = predicateBrowser();
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
    if (!body.childElementCount) body.append(...predicateBrowser());
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

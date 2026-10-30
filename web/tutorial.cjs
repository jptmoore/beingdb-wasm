// Browser tutorial checks, run in Node against the same WASM artefact and
// Rewind export the tutorial page loads. Every runnable lesson step is
// executed and compared with the `expect` block in its lesson file, so the
// lesson text cannot drift from what BeingDB actually returns.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Format = require("../tutorial/format.js");

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");
const golden = JSON.parse(read("../fixtures/rewind_golden.json"));
const lessonDir = "../tutorial/lessons";
const order = JSON.parse(read(`${lessonDir}/index.json`));
const lessons = order.map((id) => ({ id, ...JSON.parse(read(`${lessonDir}/${id}.json`)) }));

const values = (rows) => rows.map((row) => row.map(Format.cellText));
let checks = 0;

function checkBlocks(where, blocks = []) {
  assert.ok(Array.isArray(blocks), `${where}: blocks must be a list`);
  for (const b of blocks) {
    const ok =
      typeof b === "string" ||
      (b && (Array.isArray(b.list) || typeof b.note === "string" || typeof b.code === "string" || (b.table && Array.isArray(b.table.rows))));
    assert.ok(ok, `${where}: unknown block ${JSON.stringify(b)}`);
  }
}

function checkQueryStep(BeingDB, where, step) {
  const action = step.action || "execute";
  const query = step.kind === "exercise" ? step.solution : step.query;
  assert.equal(typeof query, "string", `${where}: query`);
  const method = action === "execute" ? "query" : action;
  const view = Format.classify(Format.parse(BeingDB[method](query)), action);
  const e = step.expect;
  assert.ok(e, `${where}: every runnable step needs an expect block`);

  if (e.invalid) {
    assert.equal(view.kind, "invalid", `${where}: expected invalid, got ${view.kind}`);
    assert.equal(view.errors[0].code, e.invalid, `${where}: error code`);
    return;
  }
  if (action === "explain") {
    assert.equal(view.kind, "explain", where);
    assert.ok(view.planText.includes(e.plan), `${where}: plan text ${view.planText}`);
    return;
  }
  if (action === "diagnose") {
    assert.equal(view.kind, "diagnose", where);
    assert.ok(view.diagnostics.some((d) => d.code === e.diagnostic), `${where}: diagnostic ${e.diagnostic}`);
    return;
  }
  assert.equal(view.kind, "rows", `${where}: expected rows, got ${JSON.stringify(view)}`);
  assert.deepEqual(view.warnings, [], `${where}: warnings`);
  assert.equal(view.truncated, false, `${where}: truncated`);
  const got = values(view.rows);
  if ("total" in e) assert.equal(view.total, e.total, `${where}: total`);
  if (e.rows) assert.deepEqual(got, e.rows, `${where}: rows`);
  if (e.firstRows) assert.deepEqual(got.slice(0, e.firstRows.length), e.firstRows, `${where}: first rows`);
  if (e.sortedRows) assert.deepEqual([...got].sort(), e.sortedRows, `${where}: rows (any order)`);
  if (e.diagnostic) assert.ok(view.diagnostics.some((d) => d.code === e.diagnostic), `${where}: diagnostic ${e.diagnostic}`);
  if ("provablyEmpty" in e) assert.equal(view.provablyEmpty, e.provablyEmpty, `${where}: provablyEmpty`);
  if (e.repair) {
    assert.equal(typeof view.repair?.query, "string", `${where}: repair`);
    // A proven repair must itself run and return rows.
    const repaired = Format.classify(Format.parse(BeingDB.query(view.repair.query)));
    assert.ok(repaired.kind === "rows" && repaired.total > 0, `${where}: repaired query returns rows`);
  }
}

let ran = false;
process.on("exit", () => assert.ok(ran, "BeingDB never became ready"));

globalThis.onBeingDBReady = (BeingDB) => {
  ran = true;

  // The runtime initialises and exposes the tutorial's API.
  for (const f of ["load", "query", "predicates", "diagnose", "validate", "explain"]) assert.equal(typeof BeingDB[f], "function", f);

  // The tutorial dataset loads, and is the archive revision the lessons were written against.
  const summary = JSON.parse(BeingDB.load(read("rewind.browser.json")));
  assert.equal(summary.environmentFingerprint, golden.predicates.environmentFingerprint);
  assert.equal(summary.predicates, 168);
  assert.equal(summary.facts, 1842);

  // Predicate introspection (the tutorial's :predicates / :describe).
  const predicates = JSON.parse(BeingDB.predicates()).predicates;
  const byName = Object.fromEntries(predicates.map((p) => [p.name, p]));

  for (const lesson of lessons) {
    assert.equal(typeof lesson.title, "string", `${lesson.id}: title`);
    checkBlocks(`${lesson.id} intro`, lesson.intro);
    assert.ok(Array.isArray(lesson.steps) && lesson.steps.length > 0, `${lesson.id}: steps`);
    lesson.steps.forEach((step, i) => {
      const where = `${lesson.id} step ${i + 1}`;
      checkBlocks(where, step.notes);
      const kind = step.kind || "query";
      if (kind === "predicates") {
        assert.equal(predicates.length, step.expect.predicates, `${where}: predicate count`);
        for (const name of step.expect.has) assert.ok(byName[name], `${where}: ${name}`);
      } else if (kind === "describe") {
        const p = byName[step.predicate];
        assert.ok(p, `${where}: ${step.predicate}`);
        assert.deepEqual(p.arguments.map((a) => a.role), step.expect.roles, `${where}: roles`);
        assert.deepEqual(p.arguments.map((a) => a.types), step.expect.types, `${where}: types`);
        assert.ok(p.description && p.count > 0 && p.examples.length > 0, `${where}: description, count, examples`);
      } else if (kind === "query" || kind === "exercise") {
        checkQueryStep(BeingDB, where, step);
        if (kind === "exercise") {
          // The unfinished starter query must produce a readable error, not a crash.
          const starter = Format.classify(Format.parse(BeingDB.query(step.query)));
          assert.ok(["invalid", "failure"].includes(starter.kind), `${where}: starter`);
        }
      } else assert.equal(kind, "text", `${where}: unknown step kind`);
      checks++;
    });
  }

  // Malformed input never throws: every action returns a structured, classifiable response.
  const malformed = ["", "   ", "find", "where", "find X where", "find X\nwhere\n  (", "find X\nwhere\n  created_by(X", "})]{[(", "find X\nwhere\n  p(X)\n  X >", "\u0000\u{1F600}", "x".repeat(25000)];
  for (const text of malformed) {
    for (const [method, action] of [["query", "execute"], ["diagnose", "diagnose"], ["validate", "validate"], ["explain", "explain"]]) {
      const view = Format.classify(Format.parse(BeingDB[method](text)), action);
      assert.ok(["invalid", "failure"].includes(view.kind), `${method}(${JSON.stringify(text.slice(0, 20))}) -> ${view.kind}`);
      checks++;
    }
  }
  // The runtime keeps working after malformed input.
  assert.equal(Format.classify(Format.parse(BeingDB.query("find A\nwhere\n  interviewed_artist(A)"))).total, 10);

  // Presentation helpers are defensive and escape lesson/response text.
  assert.equal(Format.classify(Format.parse("not json")).kind, "failure");
  assert.equal(Format.classify(null).kind, "failure");
  assert.equal(Format.classify({ something: "else" }).kind, "failure");
  assert.equal(Format.inline("<b>x</b> `a<b` **c**"), "&lt;b&gt;x&lt;/b&gt; <code>a&lt;b</code> <strong>c</strong>");
  assert.equal(Format.inline("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
  assert.equal(Format.literal({ type: "year", value: "1975" }), "@1975");
  assert.equal(Format.literal({ type: "string", value: "West Indies" }), '"West Indies"');

  console.log(`tutorial checks passed: ${lessons.length} lessons, ${checks} checks`);
};

require("./main.bc.wasm.js");

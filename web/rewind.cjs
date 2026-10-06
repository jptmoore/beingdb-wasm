// Load the real Rewind export into the WASM runtime (in Node) and check every
// fixture query and the predicate introspection against native server goldens.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");
const queries = JSON.parse(read("../fixtures/rewind_queries.json"));
const golden = JSON.parse(read("../fixtures/rewind_golden.json"));
const diagnoseQueries = JSON.parse(read("../fixtures/rewind_diagnose_queries.json"));

// Row order is unspecified; compare results as a sorted multiset.
const normalize = (r) =>
  r.results ? { ...r, results: r.results.map((x) => JSON.stringify(x)).sort() } : r;

let ran = false;
process.on("exit", () => assert.ok(ran, "BeingDB never became ready"));

globalThis.onBeingDBReady = (BeingDB) => {
  ran = true;
  const text = read("rewind.browser.json");
  let t = performance.now();
  const summary = JSON.parse(BeingDB.load(text));
  const loadMs = performance.now() - t;
  assert.equal(summary.environmentFingerprint, golden.predicates.environmentFingerprint);
  assert.equal(summary.predicates, golden.predicates.predicates.length);

  const predicates = JSON.parse(BeingDB.predicates());
  assert.deepEqual(predicates, golden.predicates);

  // Declared predicate metadata from the pack reaches the runtime introspection.
  const declared = Object.values(JSON.parse(text).tree.meta).map((m) => JSON.parse(m).declaration).filter(Boolean);
  const described = predicates.predicates.filter((p) => p.description).length;
  const withRoles = predicates.predicates.filter((p) => p.arguments.some((a) => a.role)).length;
  assert.equal(described, declared.filter((d) => d.description).length, "descriptions exposed");
  assert.equal(withRoles, declared.filter((d) => d.arguments).length, "argument roles exposed");
  const createdBy = predicates.predicates.find((p) => p.name === "created_by");
  assert.deepEqual(createdBy.arguments.map((a) => a.role), ["Work", "Artist"]);
  assert.match(createdBy.description, /artist/);

  const times = [];
  for (const { name, query } of queries) {
    t = performance.now();
    const got = JSON.parse(BeingDB.query(query));
    times.push(`${name}=${(performance.now() - t).toFixed(1)}ms`);
    assert.deepEqual(normalize(got), normalize(golden.queries[name]), name);
  }
  // Diagnostics (validation, data-aware diagnostics, proven repairs) equal the native server's exactly.
  for (const { name, query } of diagnoseQueries) {
    t = performance.now();
    assert.deepEqual(JSON.parse(BeingDB.diagnose(query)), golden.diagnose[name], `diagnose ${name}`);
    times.push(`diagnose:${name}=${(performance.now() - t).toFixed(1)}ms`);
  }
  console.log(
    `wasm rewind parity passed: ${JSON.stringify(summary)} load=${loadMs.toFixed(0)}ms ` +
      `descriptions=${described}/${predicates.predicates.length} roles=${withRoles}/${predicates.predicates.length}`,
  );
  console.log(times.join(" "));
};

require("./main.bc.wasm.js");

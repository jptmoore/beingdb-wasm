// Load the real Rewind export into the WASM runtime (in Node) and check every
// fixture query and the predicate introspection against native server goldens.
// Also checks that the bundled dataset, its metadata and the goldens belong to
// the same `npm run update-demo-data` run.
// Usage: node rewind.cjs [path/to/main.bc.wasm.js]   (default: this directory's build)
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const runtime = require("./runtime.cjs");

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");
const queries = JSON.parse(read("../fixtures/rewind_queries.json"));
const golden = JSON.parse(read("../fixtures/rewind_golden.json"));
const diagnoseQueries = JSON.parse(read("../fixtures/rewind_diagnose_queries.json"));
const meta = JSON.parse(read("../data/rewind.browser.meta.json"));
const STALE =
  "data/rewind.browser.json, data/rewind.browser.meta.json and fixtures/rewind_golden.json are out of sync; " +
  "regenerate them together with `npm run update-demo-data` (see README)";

// Row order is unspecified; compare results as a sorted multiset.
const normalize = (r) =>
  r.results ? { ...r, results: r.results.map((x) => JSON.stringify(x)).sort() } : r;

let ran = false;
process.on("exit", () => assert.ok(ran, "BeingDB never became ready"));

globalThis.onBeingDBReady = (BeingDB) => {
  ran = true;
  const text = read("rewind.browser.json");
  assert.equal(crypto.createHash("sha256").update(text).digest("hex"), meta.sha256, `data file checksum: ${STALE}`);
  assert.equal(golden.predicates.environmentFingerprint, meta.environmentFingerprint, `golden fingerprint: ${STALE}`);
  let t = performance.now();
  const summary = JSON.parse(BeingDB.load(text));
  const loadMs = performance.now() - t;
  // The fingerprint is computed by BeingDB from the loaded data, so this pins data, metadata and goldens together.
  assert.equal(summary.environmentFingerprint, meta.environmentFingerprint, `loaded fingerprint: ${STALE}`);
  assert.equal(summary.environmentFingerprint, golden.predicates.environmentFingerprint);
  assert.equal(summary.predicates, golden.predicates.predicates.length);
  assert.equal(summary.predicates, meta.predicates, `predicate count: ${STALE}`);
  assert.equal(summary.facts, meta.facts, `fact count: ${STALE}`);

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
  // validate/explain envelopes (projection, normalized core query, plan, planText) equal the native server's.
  const planQueries = JSON.parse(read("../fixtures/rewind_plan_queries.json"));
  for (const { name, query } of [...diagnoseQueries, ...planQueries]) {
    assert.deepEqual(JSON.parse(BeingDB.validate(query)), golden.validate[name], `validate ${name}`);
    assert.deepEqual(JSON.parse(BeingDB.explain(query)), golden.explain[name], `explain ${name}`);
  }
  console.log(
    `wasm rewind parity passed (${runtime.label}): ${JSON.stringify(summary)} load=${loadMs.toFixed(0)}ms ` +
      `descriptions=${described}/${predicates.predicates.length} roles=${withRoles}/${predicates.predicates.length} ` +
      `validate/explain=${diagnoseQueries.length + planQueries.length}`,
  );
  console.log(times.join(" "));
};

runtime.load();

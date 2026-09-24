// Load the real Rewind export into the WASM runtime (in Node) and check every
// fixture query and the predicate introspection against native server goldens.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");
const queries = JSON.parse(read("../fixtures/rewind_queries.json"));
const golden = JSON.parse(read("../fixtures/rewind_golden.json"));

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

  assert.deepEqual(JSON.parse(BeingDB.predicates()), golden.predicates);

  const times = [];
  for (const { name, query } of queries) {
    t = performance.now();
    const got = JSON.parse(BeingDB.query(query));
    times.push(`${name}=${(performance.now() - t).toFixed(1)}ms`);
    assert.deepEqual(normalize(got), normalize(golden.queries[name]), name);
  }
  console.log(`wasm rewind parity passed: ${JSON.stringify(summary)} load=${loadMs.toFixed(0)}ms`);
  console.log(times.join(" "));
};

require("./main.bc.wasm.js");

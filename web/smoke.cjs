// Load the wasm_of_ocaml artefact in Node and exercise BeingDB.query.
const assert = require("node:assert/strict");

const example = `find Artist, Work, Y
where
  created_by(Work, Artist)
  year_created(Work, Y)
  Y >= 1970`;

const rows = (r) =>
  r.results.map((row) => r.variables.map((v) => row[v].value).join(",")).sort();

let ran = false;
process.on("exit", () => assert.ok(ran, "BeingDB never became ready"));

globalThis.onBeingDBReady = (BeingDB) => {
  ran = true;
  const ok = JSON.parse(BeingDB.query(example));
  assert.deepEqual(ok.variables, ["Artist", "Work", "Y"]);
  assert.deepEqual(rows(ok), ["artist_1,work_1,1979", "artist_2,work_2,1985"]);
  assert.equal(ok.count, 2);

  const bad = JSON.parse(BeingDB.query("find W\nwhere\n  created_bi(W, A)"));
  assert.equal(bad.valid, false);
  assert.equal(bad.errors[0].code, "unknown_predicate");

  console.log("wasm smoke test passed:", JSON.stringify(ok));
};

require("./main.bc.wasm.js");

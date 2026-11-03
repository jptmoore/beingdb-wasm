// Load a BeingDB browser export with a BeingDB WASM runtime in Node and print
// the load summary as JSON; exit 1 if it does not load.
//   node scripts/check-data.cjs path/to/main.bc.wasm.js path/to/export.json
const fs = require("node:fs");
const path = require("node:path");

const [runtime, data] = process.argv.slice(2);
let done = false;
process.on("exit", (code) => {
  if (!done && code === 0) {
    console.error("the BeingDB runtime never became ready");
    process.exitCode = 1;
  }
});

globalThis.onBeingDBReady = (BeingDB) => {
  done = true;
  const summary = JSON.parse(BeingDB.load(fs.readFileSync(data, "utf8")));
  if (summary.error) {
    console.error(summary.error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(summary));
};

// The wasm_of_ocaml loader finds its .wasm assets relative to the main script.
const file = path.resolve(runtime);
require.main.filename = path.join(path.dirname(file), path.basename(require.main.filename));
require(file);

// Load a BeingDB WASM runtime in Node: this directory's fresh build, or the
// main.bc.wasm.js given as the first argument (the committed prebuilt runtime).
// In Node the wasm_of_ocaml loader reads its .wasm assets relative to the
// main script, so the main script's path is pointed at the runtime's directory.
const path = require("node:path");

const loader = process.argv[2];

module.exports = {
  label: loader ? "prebuilt runtime" : "built runtime",
  load() {
    const file = loader ? path.resolve(loader) : path.join(__dirname, "main.bc.wasm.js");
    require.main.filename = path.join(path.dirname(file), path.basename(require.main.filename));
    require(file);
  },
};

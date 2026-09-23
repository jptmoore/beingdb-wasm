// Called by the OCaml entry point once the WASM module has instantiated.
window.onBeingDBReady = (BeingDB) => {
  const status = document.getElementById("status");
  const button = document.getElementById("run");
  const result = document.getElementById("result");
  const run = () => {
    const json = BeingDB.query(document.getElementById("query").value);
    result.textContent = JSON.stringify(JSON.parse(json), null, 2);
  };
  status.textContent = "ready";
  button.disabled = false;
  button.addEventListener("click", run);
  run();
};

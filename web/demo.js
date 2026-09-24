// Called by the OCaml entry point once the WASM module has instantiated.
window.onBeingDBReady = async (BeingDB) => {
  const $ = (id) => document.getElementById(id);
  const show = (json, ms) => {
    $("result").textContent = JSON.stringify(JSON.parse(json), null, 2);
    $("timing").textContent = `${ms.toFixed(1)} ms`;
  };
  const timed = (f) => {
    const t = performance.now();
    const json = f();
    show(json, performance.now() - t);
  };

  $("status").textContent = "Loading Rewind data…";
  const t0 = performance.now();
  const text = await (await fetch("rewind.browser.json")).text();
  const t1 = performance.now();
  const summary = JSON.parse(BeingDB.load(text));
  const t2 = performance.now();
  if (summary.error) {
    $("status").textContent = `Load failed: ${summary.error.message}`;
    return;
  }
  $("status").textContent =
    `Loaded ${summary.predicates} predicates / ${summary.facts} facts ` +
    `(${summary.entries} entries; fetch ${(t1 - t0).toFixed(0)} ms, load ${(t2 - t1).toFixed(0)} ms)`;

  $("run").disabled = $("predicates").disabled = false;
  $("run").addEventListener("click", () => timed(() => BeingDB.query($("query").value)));
  $("predicates").addEventListener("click", () => timed(() => BeingDB.predicates()));
  timed(() => BeingDB.query($("query").value));
};

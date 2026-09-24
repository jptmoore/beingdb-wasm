# beingdb-wasm

A **proof-of-concept**: the real [BeingDB](../beingdb) query runtime compiled to
WebAssembly with `wasm_of_ocaml`, querying real compiled BeingDB data (the
Rewind interview pack) in a web browser.

The BeingDB parser, validator, planner, evaluator and pack/index interpretation
(`Pack_layout`) all run unchanged in the browser. The only new pieces are a
native exporter and a tiny reader for its output. See
[docs/internals.md](docs/internals.md) for details and measurements.

## What the browser data is (and is not)

`data/rewind.browser.json` is a **logical view** of a compiled pack: the same
`facts/`, `index/` and `meta/` paths and values the native runtime reads through
Irmin Pack, written out as JSON by a native exporter.

- It **is** a mechanical, deterministic dump of what the runtime already sees.
  The compiled pack stays the source of truth.
- It **is not** a new BeingDB pack format. Nothing native reads it, and it is
  not recompiled from source facts.
- The native pack is opened read-only and left untouched.

```
native:   Irmin Pack -> Pack_backend.Reader -> Pack_layout -> Query_engine
browser:  export     -> Export_reader       -> Pack_layout -> Query_engine
```

## Layout

```
src/                 portable OCaml: Session (query/introspection), Export_reader
web/                 WASM entry point, demo page, parity page, Node tests
native/              exporter + parity test (needs Irmin Pack; separate dune root)
fixtures/            shared Rewind queries + goldens from the native server
data/                rewind.browser.json (generated)
vendor/              symlink to ../beingdb/lib/runtime
```

The repositories are expected side by side (`git/beingdb`, `git/beingdb-wasm`).
No BeingDB source is copied and no BeingDB changes were needed.

## Install

Requires opam, Binaryen (`brew install binaryen`) and Node >= 22.

```sh
cd beingdb-wasm
opam switch create . ocaml-base-compiler.5.4.0 --no-install
eval $(opam env)
opam install dune lwt yojson digestif js_of_ocaml wasm_of_ocaml-compiler conf-binaryen alcotest
```

This switch has no Irmin. The exporter uses whichever switch builds `beingdb`
(the example below calls it `5.4.0`).

## Export the Rewind pack

```sh
opam exec --switch=5.4.0 -- dune exec --root native ./export_browser.exe -- \
  --pack ../beingdb/pack_store -o data/rewind.browser.json
```

## Build and test

```sh
dune build                                      # WASM + pages in _build/default/web
dune test                                       # Phase 1 tests + Rewind WASM parity (Node)
opam exec --switch=5.4.0 -- dune test --root native   # Irmin Pack vs export parity
```

To re-record goldens from native BeingDB, run
`beingdb serve --pack ../beingdb/pack_store --port 8091` and then
`node fixtures/make_golden.mjs http://localhost:8091`.

## Run in the browser

```sh
dune build --profile release     # single WASM module; required for Safari
python3 -m http.server 8000 -d _build/default
```

- <http://localhost:8000/web/>: loads Rewind, shows the predicate and fact counts,
  then a query editor.
- <http://localhost:8000/web/parity.html>: runs every fixture query against the
  native goldens and prints PASS/FAIL.

## JavaScript API

```js
window.onBeingDBReady = async (BeingDB) => {
  const text = await (await fetch("rewind.browser.json")).text();
  BeingDB.load(text);        // -> '{"predicates":168,"facts":1842,...}'
  BeingDB.query(dsl);        // -> JSON string (same shape as POST /query, dsl)
  BeingDB.predicates();      // -> JSON string (same shape as GET /predicates?detailed=true)
};
```

Load once, query many times. Before `load`, queries run against the small
Phase 1 fixture.

## Example

```
find Artist, Work, Y
where
  created_by(Work, Artist)
  year_created(Work, Y)
  Y between 1975 and 1980
```

returns 17 rows, e.g.
`{"Artist": {"type": "atom", "value": "madelon_hooykaas"}, "Work": {"type": "atom", "value": "running_time"}, "Y": {"type": "year", "value": "1979"}}`,
with the same results, count and `environmentFingerprint`
(`sha256:c99e9e82…`) as the native server.

## Browser support

Chrome/Chromium, Firefox and Safari pass the parity page with the release build.
Safari cannot load the default dev build (it lacks WebAssembly multi-memory);
see [docs/internals.md](docs/internals.md).

## Limitations

- Proof-of-concept. The whole export is fetched and held in memory, with no
  persistence, chunking or workers.
- No query timeout in the browser; the engine's intermediate-result limit applies.

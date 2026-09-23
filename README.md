# beingdb-wasm

A **proof-of-concept**: the real [BeingDB](../beingdb) query runtime compiled to
WebAssembly with `wasm_of_ocaml`, executing BeingDB DSL queries in a web browser.

It answers one question: can the existing BeingDB parser, validator, planner and
evaluator run in a browser without the native Unix/Irmin runtime? It does not
provide browser access to real BeingDB data yet.

## What it proves

```
DSL text  (JavaScript: BeingDB.query(...))
  -> Dsl_parser.parse                 (BeingDB)
  -> Dsl_lower.lower (validation)     (BeingDB)
  -> Query_engine.Make(Memory_store)  (BeingDB planner + evaluator)
  -> Core_query.apply                 (BeingDB projection/order/limit)
  -> JSON string back to JavaScript
```

All of those modules come unchanged from the local `beingdb` checkout. The data
is a tiny fixture held in BeingDB's own `Memory_store`, which compiles facts into
the same `Pack_layout` used by native packs, but in memory.

## Relationship to `beingdb`

The repositories are expected side by side:

```
git/
├── beingdb/          # lib/runtime = portable runtime (library beingdb_runtime)
└── beingdb-wasm/     # this project
```

`vendor/beingdb_runtime` is a symlink to `../beingdb/lib/runtime`. Dune builds
that directory as part of this workspace, so only the portable runtime is
visible; the Irmin/Git/Dream/CLI parts of BeingDB are not in the build at all.
No BeingDB source is copied and no BeingDB changes were needed.

## Layout

```
dune-project, dune       # (vendored_dirs vendor)
vendor/beingdb_runtime   # -> ../../beingdb/lib/runtime
src/beingdb_wasm.ml      # fixture + query : string -> JSON (portable OCaml)
web/main.ml              # wasm_of_ocaml entry point, exposes globalThis.BeingDB
web/index.html, demo.js  # minimal browser page
web/smoke.cjs            # loads the WASM artefact in Node and queries it
test/test_query.ml       # native test of the same glue
```

## Install

Requires opam, Binaryen (`wasm-opt`, >= 119) and, for the smoke test, Node >= 22.

```sh
brew install binaryen                    # or your platform's package
cd beingdb-wasm
opam switch create . ocaml-base-compiler.5.4.0 --no-install
eval $(opam env)
opam install dune lwt yojson digestif js_of_ocaml wasm_of_ocaml-compiler conf-binaryen alcotest
```

The local switch deliberately does not contain Irmin, Dream or Git libraries.

## Build and test

```sh
dune build          # builds web/main.bc.wasm.js + web/main.bc.wasm.assets/
dune test           # native test + Node WASM smoke test
```

The default (dev) profile emits one `.wasm` per library, which makes the linked
code easy to audit: `stdlib`, `lwt`, `yojson`, `digestif_ocaml`, `eqaf`,
`js_of_ocaml`, `beingdb_runtime`, `beingdb_wasm` plus the wasm_of_ocaml runtime.
There is no `unix`, `lwt.unix`, Irmin, Git or Dream module. `dune build --profile
release` links a single optimised module (about 300 KB).

## Run the browser demo

```sh
python3 -m http.server 8000 -d _build/default/web
```

Open <http://localhost:8000/>. The page runs the example query on load; edit it
and press **Run query** to try others.

## JavaScript API

```js
window.onBeingDBReady = (BeingDB) => {       // optional; called once WASM is ready
  const json = BeingDB.query(dslText);       // synchronous: string -> JSON string
};
// globalThis.BeingDB is also set once ready.
```

## Fixture

```
person(artist_1)            person(artist_2)
created_by(work_1, artist_1)  year_created(work_1, 1979)
created_by(work_2, artist_2)  year_created(work_2, 1985)
created_by(work_3, artist_1)  year_created(work_3, 1968)
```

Years are BeingDB `year` values (`Value.Year`).

## Example

```
find Artist, Work, Y
where
  created_by(Work, Artist)
  year_created(Work, Y)
  Y >= 1970
```

returns (row order is unspecified):

```json
{
  "variables": ["Artist", "Work", "Y"],
  "results": [
    {"Artist": {"type": "atom", "value": "artist_1"}, "Work": {"type": "atom", "value": "work_1"}, "Y": {"type": "year", "value": "1979"}},
    {"Artist": {"type": "atom", "value": "artist_2"}, "Work": {"type": "atom", "value": "work_2"}, "Y": {"type": "year", "value": "1985"}}
  ],
  "count": 2,
  "warnings": [],
  "language": "dsl",
  "languageVersion": "beingdb-dsl/1",
  "environmentFingerprint": "sha256:…"
}
```

Invalid queries return BeingDB's normal validation envelope, e.g. for
`created_bi(W, A)`:

```json
{"valid": false, "errors": [{"code": "unknown_predicate",
  "message": "Unknown predicate 'created_bi'; did you mean: created_by, year_created?",
  "line": 3, "column": 3, "predicate": "created_bi", "suggestions": ["created_by", "year_created"]}],
  "warnings": [], "language": "dsl", …}
```

The response shapes match the native server's `POST /query` with
`language: "dsl"`, `action: "execute"`.

## Browser requirements

A browser with WebAssembly GC, tail calls and exception handling (what
`wasm_of_ocaml` targets), e.g. current Chromium. Other browsers were not tested.

Tested with: Chromium 150 (VS Code integrated browser, Electron 43), Node
23.4, OCaml 5.4.0, dune 3.21, js_of_ocaml/wasm_of_ocaml 6.4.1, Binaryen 133,
Lwt 6.1.2, Yojson 3.0.0, digestif 1.3.1.

## Limitations and findings

- **Proof-of-concept only.** Data is a fixed in-memory fixture; there is no
  browser access to compiled BeingDB packs, and no persistence.
- `digestif` is a virtual library whose default implementation (`digestif.c`)
  uses C stubs; the WASM executable selects `digestif.ocaml` explicitly.
- Core `Lwt` works unchanged. There is no `Lwt_main` in the browser, so the
  promise is driven by `Lwt.wakeup_paused` (as BeingDB's own `test_runtime`
  does); this is sufficient because `Memory_store` resolves immediately and the
  engine only yields via `Lwt.pause`. `query` is therefore synchronous.
- No query timeout: the native server uses `Lwt_unix.with_timeout`, which is not
  portable. The runtime's intermediate-result limit still applies.
- The JSON response envelope is assembled in `src/beingdb_wasm.ml` because the
  native equivalent lives in `Controller` (outside the portable runtime).

## Next step (not implemented)

Query a real compiled pack: implement a small browser reader with the
`find`/`list` signature that `Pack_layout.Make` already consumes (as
`Memory_store.Reader` does), backed by a pre-fetched export of a pack's
key/value tree, and drive the resulting Lwt promises from JavaScript.

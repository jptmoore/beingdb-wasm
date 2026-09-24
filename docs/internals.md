# beingdb-wasm internals

Technical notes for the proof-of-concept. See the [README](../README.md) for usage.

## Execution path

```
BeingDB.load(text)   JSON text  -> Export_reader (OCaml, in WASM) -> in-memory tree
BeingDB.query(dsl)   Dsl_parser -> Dsl_lower -> Query_engine.Make(Pack_layout.Make(Export_reader))
                     -> Core_query.apply -> JSON
```

Everything after `Export_reader` is unchanged BeingDB code from the local
`beingdb` checkout (`lib/runtime`): `Pack_layout.Make` does all fact decoding,
manifest reading, `_all` scans and equality/range index lookups; the planner and
evaluator are `Query_engine`. JavaScript only fetches text and calls the API.

`src/`:

- `session.ml` - `Session.Make (Store : Runtime_store.S)`: query and predicate
  introspection, shaped like the native server's `POST /query` (dsl, execute)
  and `GET /predicates?detailed=true`. Used for the fixture, the export and (in
  native tests) Irmin Pack.
- `export_reader.ml` - the `Pack_layout.READER` (`find`/`list`) over the export.
- `beingdb_wasm.ml` - browser state: Phase 1 fixture (`Memory_store`) until
  `load` is called, then the export.

## Export format (`beingdb-logical-pack-view`, version 0)

```json
{"format": "beingdb-logical-pack-view", "formatVersion": 0,
 "tree": {"facts": {"<fact-id>": "<encoded fact>", ...},
          "index": {"<pred>": {"_all": {"<fact-id>": ""}, "0": {"atom": {"<key>": {"<fact-id>": ""}}}}},
          "meta":  {"<pred>": "<manifest JSON>"}}}
```

An object is a directory; a string is the contents at that path. Children appear
in the order the native `Pack_backend.Reader.list` returns them, so `list` over
the export returns exactly what the native reader returns (this keeps
`sample_facts`, and therefore predicate `examples`, identical).

The exporter (`native/pack_export.ml`) walks the pack from the root with
`Pack_backend.Reader.find`/`list` (the same reader `Pack_backend` feeds into
`Pack_layout.Make`) and writes that tree. It does not recompile facts, rebuild
indexes, or interpret anything. Output is deterministic (same bytes on re-export;
checked by the parity test).

This is an experiment transport format only: a mechanical dump of the logical
tree. It is not a BeingDB pack format and nothing native reads it.

## Build roots and switches

| root | switch | contents |
|---|---|---|
| `.` | local `_opam` (no Irmin) | portable glue, WASM entry point, Phase 1 test, Node tests |
| `native/` | any switch that builds `beingdb` (Irmin Pack 3.11) | exporter, parity test |

`native/` is excluded from the root (`(dirs :standard \ native)`) and reaches
BeingDB through symlinks: `vendor/beingdb_runtime`, `vendor/beingdb_pack_unix`,
`vendor/beingdb_wasm -> ../src`, plus `data` and `fixtures`. Two switches are
used because Irmin Pack 3.11 requires `cmdliner < 2` while wasm_of_ocaml 6.4
requires `cmdliner >= 2`; keeping them apart also means the browser build
cannot see Irmin at all.

## Parity tests

Shared fixtures: `fixtures/rewind_queries.json` (12 DSL queries: simple, constant
binding, 3-way join, year `>=`, year `between`, integer `>`, optional + order by,
negation, and four invalid queries) and `fixtures/rewind_golden.json`, recorded
from the native server by `fixtures/make_golden.mjs`.

- `native/test_parity.ml` (Irmin Pack vs export, both via `Pack_layout`):
  re-export equals `data/rewind.browser.json`; same predicate list and order;
  identical manifests and facts per predicate; every fact body decodes;
  `Session` over Irmin Pack and over the export both equal the server goldens
  for predicates and every query.
- `web/rewind.cjs` (WASM in Node) and `web/parity.html` (WASM in a browser):
  load the export, compare `predicates()` and every query with the goldens.

Rows are compared as a sorted multiset (row order is unspecified); everything
else (variables, count, typed values, warnings, errors, fingerprint) is exact.

## Measurements (Rewind pack, 2026-09-24, Apple Silicon)

| | |
|---|---|
| Native pack on disk (`pack_store/`) | 1.6 MB |
| Export (`data/rewind.browser.json`) | 649 KB, 211 KB gzip -9 |
| Logical entries | 6,639 (1,842 facts, 4,629 index, 168 meta) |
| Predicates / facts | 168 / 1,842 |
| Export time | < 1 s |
| WASM, release (single module) | 304 KB (106 KB gzip) + 16 KB JS loader |
| WASM, dev (per library) | ~1.5 MB total |
| `load` (parse + build env) | 30-80 ms (Chromium, Chrome, Safari, Node); Firefox 83-377 ms |
| Queries | 0.1-12 ms each; native server 3-9 ms for the same queries |

## Browser support findings

| Browser | dev build | release build |
|---|---|---|
| Chromium 150 (VS Code), Chrome 153 | pass | pass |
| Firefox 156 | pass | pass |
| Safari 27 | fails | pass |

Safari fails on the dev build with `CompileError: WebAssembly.Module doesn't
parse ... Memory section has more than one memory`: the separately compiled
wasm_of_ocaml runtime module uses multiple memories, which Safari does not
support. The release build is linked into one module and runs.

## Other findings

- `digestif` is a virtual library whose default (`digestif.c`) uses C stubs; the
  WASM executable selects `digestif.ocaml`.
- Core `Lwt` works unchanged. Promises are driven by `Lwt.wakeup_paused` (as
  BeingDB's `test_runtime` does); all reads are in memory, so `load`/`query` are
  synchronous and only the network fetch is async.
- No query timeout in the browser (`Lwt_unix.with_timeout` is not portable); the
  engine's intermediate-result limit still applies.
- The JSON envelope is assembled in `src/session.ml` because the native
  equivalent lives in `Controller`, outside the portable runtime.
- The export is held fully in memory (JSON AST, then the tree). Fine at this
  size; it is the thing to revisit for much larger packs.

# beingdb-wasm

**BeingDB WASM** is the real [BeingDB](https://github.com/jptmoore/beingdb)
query runtime compiled to WebAssembly with `wasm_of_ocaml`, running entirely in
a web browser against a bundled copy of the REWIND interviews dataset. It is a
proof-of-concept.

The BeingDB parser, validator, planner, evaluator and pack/index interpretation
all run unchanged in the browser; queries never leave the page. See
[docs/internals.md](docs/internals.md) for details and measurements.

## Try it in the browser

Open the tutorial: **<https://jptmoore.github.io/beingdb-wasm/tutorial/>**

- It runs entirely in your browser: no server, no account.
- No OCaml and no native BeingDB installation are needed.
- It ships with a prebuilt REWIND demo dataset, so there is no data to create
  or download separately.

It is an interactive walkthrough of the BeingDB query language; see
[tutorial/README.md](tutorial/README.md).

## Run locally

Requires Node >= 22 and nothing else (there are no npm dependencies, so no
`npm install` step):

```sh
git clone https://github.com/jptmoore/beingdb-wasm.git
cd beingdb-wasm
npm run dev
```

Then open <http://localhost:8000/beingdb-wasm/tutorial/> (`npm run dev -- --port N`
for another port). The local server uses the same base path as GitHub Pages.

The repository includes a prebuilt REWIND dataset
([data/rewind.browser.json](data/rewind.browser.json)) and a prebuilt BeingDB
WASM runtime ([prebuilt/](prebuilt/)). You do not need native BeingDB, OCaml,
or a locally compiled pack store to use BeingDB WASM. The OCaml toolchain is
only needed to rebuild the runtime from source
([Development and testing](#development-and-testing)), and native BeingDB only
to regenerate the bundled dataset
([Maintainer: rebuilding the bundled dataset](#maintainer-rebuilding-the-bundled-dataset)).

`npm run dev` copies the tutorial from `tutorial/` when it starts, so re-run it
to pick up tutorial edits. It does not rebuild the WASM runtime: after changing
OCaml code, build from source with `npm run tutorial`
([Development and testing](#development-and-testing)).

## How it works

```
native BeingDB:  compiled pack -> Irmin Pack reader -> Pack_layout -> query engine
BeingDB WASM:    bundled data  -> Export_reader     -> Pack_layout -> query engine
```

The bundled dataset, [data/rewind.browser.json](data/rewind.browser.json)
("BeingDB browser data"), is a **logical view** of a compiled BeingDB pack:
the same `facts/`, `index/` and `meta/` paths and values the native runtime
reads, written out as JSON by a native exporter.

- It **is** a mechanical, deterministic dump of what the native runtime sees.
  The compiled pack stays the source of truth.
- It **is not** a new BeingDB pack format. Nothing native reads it, and it is
  not recompiled from source facts.

The only new code is that exporter ([native/](native/)), a small reader for its
output ([src/export_reader.ml](src/export_reader.ml)) and the JavaScript
bindings ([web/main.ml](web/main.ml)). All query behaviour is BeingDB's own.

## Using the JavaScript/WASM API

```js
window.onBeingDBReady = async (BeingDB) => {
  const text = await (await fetch("rewind.browser.json")).text();
  BeingDB.load(text);        // -> '{"predicates":168,"facts":1842,...}'
  BeingDB.query(dsl);        // -> JSON string (same shape as POST /query, dsl)
  BeingDB.predicates();      // -> JSON string (same shape as GET /predicates?detailed=true)
  BeingDB.diagnose(dsl);     // -> JSON string (same body as POST /query, dsl, action "diagnose")
  BeingDB.validate(dsl);     // -> JSON string (same body as POST /query, dsl, action "validate")
  BeingDB.explain(dsl);      // -> JSON string (same body as POST /query, dsl, action "explain")
};
```

Load once, query many times. Before `load`, queries run against the small
Phase 1 fixture.

`query(dsl)` caps results at 1000 rows, like the native server's default
`max_results`, and reports it the same way: `count` is the number of rows
returned, `total` the number the query matches (regardless of `limit`, `offset`
or the cap), `hasMore` is `true` when more rows match than were returned (the
query's own `limit` or the cap stopped it), and `truncated` is `true`, with a
`results_truncated` warning, only when the cap did.
When the first page is empty, the response also carries the `diagnose` fields
(`diagnostics`, `provablyEmpty`, any proven `repair`) explaining why, exactly as
the native server does.

`predicates()` is BeingDB's own `Query_environment.to_json`. Each predicate has
`name`, `arity`, `count`, `arguments` (`position`, `types`) and `examples`.
When the pack declares them, it also has `description` and, per argument,
`role` and `semanticType`. For example, `created_by` has roles `Work`, `Artist`
and the description "Relates a work to the artist or artist group who made it."
Declarations are descriptive only: they do not change how queries validate or
run, but they are part of the `environmentFingerprint`.

`diagnose(dsl)` runs BeingDB's own `Query_diagnostics` (validation, data-aware
diagnostics such as `constant_not_at_position` or `disjoint_join`, likely
corrections for a misspelled constant in `evidence.suggestions`, and any
repair BeingDB can prove, as `repair.query`) without executing the query. No
diagnostic logic lives in this layer; the output equals the native server's
(checked against goldens in `fixtures/rewind_golden.json`, `diagnose` key). See
BeingDB's [API reference](https://github.com/jptmoore/beingdb/blob/main/docs/api.md#diagnose-dsl) for the codes.

`validate(dsl)` and `explain(dsl)` are the native server's `validate` and
`explain` actions: the query is parsed and checked against the data but not
executed. A valid query returns `valid: true` with its `projection` and
`distinct` flag (`validate`), or with BeingDB's `normalizedCoreQuery`,
structured `plan` and human-readable `planText` (`explain`). An invalid query
returns the same `valid: false` error envelope as `query`. Both equal the
native server's responses (`validate` and `explain` keys in the goldens).

### Example

```
find Artist, Work, Y
where
  created_by(Work, Artist)
  year_created(Work, Y)
  Y between 1975 and 1980
```

returns 17 rows, e.g.
`{"Artist": {"type": "atom", "value": "madelon_hooykaas"}, "Work": {"type": "atom", "value": "running_time"}, "Y": {"type": "year", "value": "1979"}}`,
with the same results, count and `environmentFingerprint` as the native server
(the fingerprint of the bundled dataset is recorded in
[data/rewind.browser.meta.json](data/rewind.browser.meta.json)).

## Development and testing

Building the runtime from source needs opam, Binaryen
(`brew install binaryen`), Node >= 22, and BeingDB checked out next to this
repository. Only BeingDB's portable runtime sources are used
(`vendor/beingdb_runtime` is a committed symlink to `../beingdb/lib/runtime`);
nothing native is compiled and no pack store is needed.

```sh
git clone https://github.com/jptmoore/beingdb.git      # next to beingdb-wasm
cd beingdb-wasm
opam switch create . ocaml-base-compiler.5.4.0 --no-install
eval $(opam env)
opam install dune lwt yojson digestif js_of_ocaml wasm_of_ocaml-compiler conf-binaryen alcotest
```

| Command | What it does |
|---|---|
| `npm test` | `dune test` (unit tests; WASM parity with native goldens and every tutorial lesson, for both the fresh build and `prebuilt/`), then `node scripts/maintain.mjs check` |
| `npm run tutorial` | Release build from source, assemble `dist/site/`, serve it at <http://localhost:8000/beingdb-wasm/tutorial/> |
| `npm run build:tutorial` | Release build (one WASM module, which Safari requires), then assemble `dist/site/` |
| `npm run verify:tutorial` | Check `dist/site/` in headless Chrome under `/beingdb-wasm/` |
| `npm run deploy` | Run the GitHub Pages workflow on `main` (needs `gh`) |
| `npm run update-runtime` | Maintainer: rebuild the release runtime into `prebuilt/` |

`dune build` alone builds the runtime and the pages in `_build/default/web`
(demo and parity pages) and `_build/default/tutorial`; serve them with
`python3 -m http.server 8000 -d _build/default` (use `dune build --profile
release` for Safari).

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) tests, builds and
verifies the site on pull requests. Deployment to GitHub Pages is manual, from
`main` (`npm run deploy`), so other work on `main` never republishes the
tutorial. See [tutorial/README.md](tutorial/README.md#deploy).

### The prebuilt runtime

[prebuilt/](prebuilt/) holds the release build of the runtime
(`main.bc.wasm.js` and one `.wasm` module) used by `npm run dev`, and
[prebuilt/runtime.json](prebuilt/runtime.json) records the BeingDB commit, the
toolchain, file checksums and a hash of the runtime sources (this
repository's OCaml and `../beingdb/lib/runtime`). `npm test` runs the parity
and lesson tests against it, and fails if its files do not match
`runtime.json`, if the runtime sources have changed since it was built, or if
CI's `BEINGDB_REF` pins a different BeingDB commit. Refresh it with:

```sh
npm run update-runtime    # refuses a ../beingdb with uncommitted changes (--allow-dirty to override)
npm test
```

then commit `prebuilt/` (and update `BEINGDB_REF` in `pages.yml` when moving
to a new BeingDB commit).

### Layout

```
src/                 portable OCaml: Session (query/introspection), Export_reader
web/                 WASM entry point, demo page, parity page, Node tests
tutorial/            interactive browser tutorial (lessons + thin UI over the WASM API)
prebuilt/            prebuilt release runtime for `npm run dev` (generated)
data/                bundled REWIND dataset and its metadata (generated)
fixtures/            shared REWIND queries + goldens from the native server
scripts/site.mjs     static site: dev, build, serve, verify, deploy
scripts/maintain.mjs maintainer: update-demo-data, update-runtime, check
native/              exporter + parity test (needs Irmin Pack; separate dune root)
vendor/              symlink to ../beingdb/lib/runtime
```

## Maintainer: rebuilding the bundled dataset

Only needed when the REWIND facts or BeingDB's pack format change. Using or
developing BeingDB WASM does not need any of this.

### Pipeline

```
REWIND facts (github.com/jptmoore/beingdb-rewind-interviews)
        |  beingdb clone (or beingdb import)
        v
Irmin Git store
        |  beingdb compile                          native BeingDB (../beingdb)
        v
compiled pack (pack store)
        |  native/export_browser.exe                this repository
        v
data/rewind.browser.json                            bundled dataset
  + fixtures/rewind_golden.json                     native `beingdb serve` responses,
                                                    including the environmentFingerprint
  + data/rewind.browser.meta.json                   checksum, fingerprint, counts, provenance
        |  WASM tests, native parity test, tutorial lessons
        v
tutorial / app (npm run dev, GitHub Pages)
```

### One command

```sh
npm run update-demo-data
```

This runs the whole pipeline in a temporary directory. It does not modify
the facts or any existing pack store:

1. builds native BeingDB in `../beingdb`;
2. clones the REWIND facts (default
   `https://github.com/jptmoore/beingdb-rewind-interviews.git`) and compiles
   them into a fresh pack;
3. exports the pack as browser data;
4. starts native `beingdb serve` on the pack and records the goldens
   (`fixtures/make_golden.mjs`), which include its `environmentFingerprint`;
5. installs `data/rewind.browser.json`, `data/rewind.browser.meta.json` and
   `fixtures/rewind_golden.json` together;
6. validates: `dune build`; `dune test` (the WASM runtime, built and prebuilt,
   loads the data and reproduces every golden, including the fingerprint,
   and every tutorial lesson); the native Irmin Pack vs export parity test;
   `node scripts/maintain.mjs check`.

If anything fails before step 5, nothing in the repository changes. If
validation fails after it, the three files are still consistent with each
other: fix what failed (for example a tutorial lesson whose expected rows
changed), or revert with `git checkout -- data fixtures`.

| Option | Environment variable | |
|---|---|---|
| `--source URL` or `--source DIR` | `REWIND_SOURCE` | Facts to compile: a Git URL, or a local checkout (imported with `beingdb import`, including uncommitted changes, which are recorded as `dirty`) |
| `--pack DIR` | `BEINGDB_PACK` | Export an already compiled pack instead (its source is then not recorded) |
| | `BEINGDB_OPAM_SWITCH` | opam switch with native BeingDB's dependencies (default: the switch opam selects in `../beingdb`) |

Requirements: BeingDB checked out at `../beingdb` (the `native/vendor`
symlinks point there), opam, and native BeingDB's dependencies (Irmin) in an
opam switch, for example `(cd ../beingdb && opam install . --deps-only)`.
This repository's own switch does not need Irmin. If something is missing,
the command says what and how to fix it.

### Fingerprints

BeingDB computes the `environmentFingerprint` from the data it loads
(predicate names, arities, observed types and any declared roles and
descriptions), so the browser always reports the fingerprint of the data it
actually loaded. Copies of it are pinned in `fixtures/rewind_golden.json` and
`data/rewind.browser.meta.json`. `npm test` (and `dune test`) fails, naming
`npm run update-demo-data`, if the data file, its metadata and the goldens do
not agree, so a new pack with an old bundle or old fingerprint metadata cannot
pass unnoticed.

Artefacts in other repositories that pin the fingerprint are not updated by
this command. When it reports a changed fingerprint, regenerate them
separately, for example the
[beingdb-webllm](https://github.com/jptmoore/beingdb-webllm) evaluation
question sets (`eval/questions*.json`).

### Manual steps

The command wraps these, which can help with debugging. With a compiled pack
at `PACK` and native BeingDB's opam switch `SWITCH`:

```sh
opam exec --switch=SWITCH -- dune exec --root native ./export_browser.exe -- \
  --pack PACK -o data/rewind.browser.json
beingdb serve --pack PACK --port 8091 &
node fixtures/make_golden.mjs http://localhost:8091
BEINGDB_PACK=PACK opam exec --switch=SWITCH -- dune test --root native   # Irmin Pack vs export parity
```

Only `npm run update-demo-data` writes `data/rewind.browser.meta.json`, so
after manual steps, run it (with `--pack PACK`) to bring all three files back
in line.

## Browser support

Chrome/Chromium, Firefox and Safari pass the parity page with the release build.
Safari cannot load the default dev build (it lacks WebAssembly multi-memory);
see [docs/internals.md](docs/internals.md).

## Limitations

- Proof-of-concept. The whole export is fetched and held in memory, with no
  persistence, chunking or workers.
- No query timeout in the browser; the engine's intermediate-result limit applies.

# BeingDB WASM

**Query [BeingDB](https://github.com/jptmoore/beingdb) facts in the web
browser. No server, nothing to install.**

BeingDB WASM is BeingDB's own query engine compiled to WebAssembly. It turns a
compiled BeingDB pack store into a static website: put the files on GitHub
Pages (or any static host) and anyone can browse the predicates and run
queries in their browser.

- **The real engine.** BeingDB's parser, validator, planner, evaluator,
  diagnostics and proven repairs run unchanged in the browser, and responses
  are tested to match the native `beingdb serve` exactly.
- **Static hosting.** No database server to run, secure or pay for. A site is
  a few small files plus your data.
- **Nothing to install for your users**, and nothing beyond Node for you: no
  OCaml, no Docker.
- **Private.** Queries run locally and never leave the page.
- **Small.** The runtime is 370 KB (120 KB gzipped). The REWIND example, with
  1,778 facts, is a 615 KB data file (200 KB gzipped).

## Try it

- **[REWIND interviews](https://jptmoore.github.io/beingdb-rewind-interviews/)**:
  facts from artists' interviews, published with BeingDB WASM on GitHub
  Pages. It is the example to copy (see
  [Publish on GitHub Pages](#publish-on-github-pages)).
- **[Interactive tutorial](https://jptmoore.github.io/beingdb-wasm/tutorial/)**:
  learn the BeingDB query language step by step, on the same data.

## Publish your own facts

You need a BeingDB export of your facts and Node >= 22.

**1. Export your facts with BeingDB.** BeingDB compiles a Git repository of
facts into a pack store, and `beingdb export` writes that pack as a single
file for the browser. See the BeingDB
[README](https://github.com/jptmoore/beingdb#run-in-the-browser) for
installing BeingDB and compiling facts.

```sh
beingdb export --pack ./pack_store -o facts.browser.json
```

**2. Bundle it into a site.**

```sh
git clone https://github.com/jptmoore/beingdb-wasm.git
cd beingdb-wasm
npm run bundle -- --data ../facts.browser.json --title "My facts" --out ../my-site
npm run preview -- ../my-site        # http://localhost:8000/
```

There are no npm dependencies, so there is no `npm install` step. The bundle
uses the prebuilt runtime in [prebuilt/](prebuilt/), and checks that your data
loads in it before writing anything.

**3. Publish the folder** on any static host: GitHub Pages, Netlify,
Cloudflare Pages, S3, or a plain web server. It is self-contained:

```
my-site/
  index.html, explorer.js, ui.js, format.js, style.css   the page
  beingdb.json                                           title, description, examples, data URL
  runtime/                                               BeingDB WASM runtime
  data/facts.browser.json                                your facts
```

To update the site, export again and re-run `npm run bundle` (it only
overwrites a directory it created).

### Configure the page: `beingdb.json`

```json
{
  "title": "My facts",
  "description": "Facts about ... Compiled from [my-facts](https://github.com/me/my-facts).",
  "data": "data/facts.browser.json",
  "examples": [
    { "title": "Works after 1970", "query": "find Work, Y\nwhere\n  year_created(Work, Y)\n  Y > 1970" }
  ]
}
```

| Field | |
|---|---|
| `title` | Page heading |
| `description` | Introductory text; supports `` `code` ``, `**bold**` and `[links](https://...)` |
| `data` | URL of the export, relative to the page or absolute |
| `examples` | Example queries, shown as buttons; the first is loaded into the editor |

Pass your own file with `npm run bundle -- --config beingdb.json ...`; the
bundle sets `data`. Without examples, the editor starts with a query over
the largest predicate.

### Data hosted elsewhere: `?data=`

The page also loads any export given in its URL, for example
`https://example.org/my-site/?data=https://example.org/other.browser.json`.
The configured title, description and examples are then not shown. Data on
another site must be served with CORS (GitHub Pages and
`raw.githubusercontent.com` are).

### Publish on GitHub Pages

If your facts live in a GitHub repository, bundle into its `docs/` folder
and commit it:

```sh
npm run bundle -- --data ../facts.browser.json --config ../my-facts/site/beingdb.json --out ../my-facts/docs
```

Then set Settings > Pages > Source: "Deploy from a branch", `main`, `/docs`.
Every push then publishes, with no workflow to maintain. Re-export and
re-bundle whenever the facts change. The
[REWIND interviews](https://github.com/jptmoore/beingdb-rewind-interviews)
repository works this way; its `npm run build-site`
([scripts/build-site.mjs](https://github.com/jptmoore/beingdb-rewind-interviews/blob/main/scripts/build-site.mjs))
compiles, exports and bundles in one step.

### Versions

Export your facts with the BeingDB version the runtime was built from. It is
recorded in [prebuilt/runtime.json](prebuilt/runtime.json) (`beingdb.commit`).
The export is versioned (`format`, `formatVersion`); the runtime rejects a
file it cannot read, and `npm run bundle` checks that your file loads before
writing the site.

## The JavaScript API

The page is a thin layer over a small API, which you can also use directly in
your own pages. Load the runtime (`runtime/main.bc.wasm.js`, which finds its
`.wasm` next to itself) and it calls `window.onBeingDBReady`:

```js
window.onBeingDBReady = async (BeingDB) => {
  const text = await (await fetch("data/facts.browser.json")).text();
  BeingDB.load(text);        // -> '{"predicates":114,"facts":1778,...}'
  BeingDB.query(dsl);        // -> JSON string (same shape as POST /query, dsl)
  BeingDB.predicates();      // -> JSON string (same shape as GET /predicates?detailed=true)
  BeingDB.diagnose(dsl);     // -> JSON string (same body as POST /query, dsl, action "diagnose")
  BeingDB.validate(dsl);     // -> JSON string (same body as POST /query, dsl, action "validate")
  BeingDB.explain(dsl);      // -> JSON string (same body as POST /query, dsl, action "explain")
  BeingDB.resolve(text, candidates);  // -> JSON string (same body as GET /resolve)
  BeingDB.about(value, limit);        // -> JSON string (same body as GET /about)
};
```

Load once, query many times. `load` returns `{"error": ...}` for a file it
cannot read. Before `load`, queries run against a tiny built-in sample.

Every response has the shape of the native server's; see BeingDB's
[API reference](https://github.com/jptmoore/beingdb/blob/main/docs/api.md).

- `query(dsl)` caps results at 1000 rows, like the server's default
  `max_results`: `count` is the number of rows returned, `total` the number
  the query matches, `hasMore` is `true` when more rows match than were
  returned, and `truncated` (with a `results_truncated` warning) is `true`
  only when the cap stopped it. An empty first page also carries the
  `diagnose` fields explaining why.
- `predicates()` lists each predicate's `name`, `arity`, `count`, argument
  `types` and `examples`, plus any declared `description`, `role` and
  `semanticType`, and the `environmentFingerprint` of the loaded data.
- `diagnose(dsl)` reports problems without running the query: validation,
  data-aware [diagnostics](https://github.com/jptmoore/beingdb/blob/main/docs/api.md#diagnose-dsl)
  such as `constant_not_at_position`, suggestions for a misspelled constant,
  and any repair BeingDB can prove (`repair.query`).
- `validate(dsl)` and `explain(dsl)` check a query against the data without
  running it, returning its projection, or BeingDB's normalized query and
  plan (`plan`, `planText`).
- `resolve(text, candidates)` finds the stored values a text mentions (for
  example the names in a question), matching exactly, by
  [`label`/`alias`](https://github.com/jptmoore/beingdb/blob/main/docs/query-language.md#naming-values-label-and-alias),
  with small misspellings, or as part of a longer name; see
  [`GET /resolve`](https://github.com/jptmoore/beingdb/blob/main/docs/api.md#resolve-values-mentioned-in-text).
  `candidates` (1-50, default 10) is optional. The name index is built on
  the first call after `load`.
- `about(value, limit)` lists every fact a value (one literal, e.g.
  `judith_goddard` or `"Hey Bud"`) occurs in, grouped by predicate and
  position, at most `limit` (1-100, default 20) per group; see
  [`GET /about`](https://github.com/jptmoore/beingdb/blob/main/docs/api.md#everything-about-a-value).

## How it works

```
native BeingDB:  pack store         -> Irmin Pack reader -> Pack_layout -> query engine
BeingDB WASM:    beingdb export file -> Export_reader    -> Pack_layout -> query engine
```

`beingdb export` writes the pack's logical tree, the same `facts/`, `index/`
and `meta/` paths and values the native engine reads, as JSON. It is a
mechanical, deterministic copy: nothing is recompiled, and the pack stays the
source of truth. In the browser, a small reader
([src/export_reader.ml](src/export_reader.ml)) serves that tree to BeingDB's
unchanged runtime. The only other code here is the JavaScript bindings
([web/main.ml](web/main.ml)) and the pages. See
[docs/internals.md](docs/internals.md) for details and measurements.

## Browser support

Current Chrome and other Chromium browsers, Firefox and Safari. The release build used by
`npm run bundle` is a single WebAssembly module, which Safari requires; see
[docs/internals.md](docs/internals.md#browser-support-findings).

## Limitations

- The whole export is downloaded and held in memory. This suits small and
  medium datasets; very large packs would need chunked loading.
- There is no query timeout in the browser; the engine's limit on
  intermediate results still applies.
- The site is read-only, like `beingdb serve`: to change the facts, edit them
  in Git, compile, export and publish again.

## Developing BeingDB WASM

Everything below is for working on BeingDB WASM itself.

### Run the tutorial locally

```sh
npm run dev
```

serves the tutorial and the explorer with the prebuilt runtime at
<http://localhost:8000/beingdb-wasm/tutorial/> and
<http://localhost:8000/beingdb-wasm/explorer/> (`npm run dev -- --port N` for
another port), under the same base path as GitHub Pages. It copies the pages
when it starts, so re-run it after editing them. See
[tutorial/README.md](tutorial/README.md).

### Build from source

Building the runtime needs opam, Binaryen (`brew install binaryen`), Node >=
22, and BeingDB checked out next to this repository. Only BeingDB's portable
runtime sources are used (`vendor/beingdb_runtime` is a committed symlink to
`../beingdb/lib/runtime`); nothing native is compiled.

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
| `npm run verify:tutorial` | Check `dist/site/` (tutorial and explorer) in headless Chrome under `/beingdb-wasm/` |
| `npm run deploy` | Run the GitHub Pages workflow on `main` (needs `gh`) |
| `npm run update-runtime` | Rebuild the release runtime into `prebuilt/` |
| `npm run update-demo-data` | Regenerate the bundled REWIND dataset (see below) |

`dune build` alone builds the runtime and the pages in `_build/default/web`
(API demo and parity pages) and `_build/default/tutorial`; serve them with
`python3 -m http.server 8000 -d _build/default` (use `dune build --profile
release` for Safari).

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) tests, builds and
verifies the site on pull requests. Deployment to GitHub Pages is manual, from
`main` (`npm run deploy`). See [tutorial/README.md](tutorial/README.md#deploy).

### The prebuilt runtime

[prebuilt/](prebuilt/) holds the release build of the runtime used by
`npm run bundle` and `npm run dev`, and
[prebuilt/runtime.json](prebuilt/runtime.json) records the BeingDB commit, the
toolchain, file checksums and a hash of the runtime sources. `npm test` runs
the parity and lesson tests against it, and fails if its files do not match
`runtime.json`, if the runtime sources have changed since it was built, or if
CI's `BEINGDB_REF` pins a different BeingDB commit. Refresh it with:

```sh
npm run update-runtime    # refuses a ../beingdb with uncommitted changes (--allow-dirty to override)
npm test
```

then commit `prebuilt/` (and update `BEINGDB_REF` in `pages.yml` when moving
to a new BeingDB commit). Published sites keep the runtime they were bundled
with until they are re-bundled.

### Layout

```
src/                 portable OCaml: Session (query/introspection), Export_reader
web/                 WASM entry point, API demo page, parity page, Node tests
explorer/            the deployable query page (bundled by `npm run bundle`)
tutorial/            interactive tutorial; ui.js and format.js are shared with the explorer
prebuilt/            prebuilt release runtime (generated)
data/                bundled REWIND dataset and its metadata (generated)
fixtures/            shared REWIND queries + goldens from the native server
scripts/site.mjs     static sites: bundle, dev, build, serve, verify, deploy
scripts/maintain.mjs maintainer: update-demo-data, update-runtime, check
native/              Irmin Pack vs export parity test (needs Irmin Pack; separate dune root)
vendor/              symlink to ../beingdb/lib/runtime
```

### The bundled REWIND dataset

The tutorial and the tests use a bundled export of the
[REWIND interviews](https://github.com/jptmoore/beingdb-rewind-interviews)
([data/rewind.browser.json](data/rewind.browser.json)), with goldens recorded
from the native server ([fixtures/rewind_golden.json](fixtures/rewind_golden.json))
and metadata ([data/rewind.browser.meta.json](data/rewind.browser.meta.json):
checksum, `environmentFingerprint`, counts, provenance). Regenerate all three
when the REWIND facts or BeingDB's pack format change:

```sh
npm run update-demo-data
```

This works in a temporary directory and does not modify the facts or any
existing pack store:

1. builds native BeingDB in `../beingdb`;
2. clones the REWIND facts and compiles them into a fresh pack;
3. exports it with `beingdb export`;
4. starts native `beingdb serve` on the pack and records the goldens
   (`fixtures/make_golden.mjs`), which include its `environmentFingerprint`;
5. installs the dataset, its metadata and the goldens together;
6. validates: `dune build`; `dune test` (the built and prebuilt runtimes load
   the data and reproduce every golden and every tutorial lesson); the native
   Irmin Pack vs export parity test; `node scripts/maintain.mjs check`.

If anything fails before step 5, nothing in the repository changes. If
validation fails after it, the three files are still consistent with each
other: fix what failed (for example a tutorial lesson whose expected rows
changed), or revert with `git checkout -- data fixtures`.

| Option | Environment variable | |
|---|---|---|
| `--source URL` or `--source DIR` | `REWIND_SOURCE` | Facts to compile: a Git URL (default `https://github.com/jptmoore/beingdb-rewind-interviews.git`), or a local checkout (imported with `beingdb import`, including uncommitted changes, which are recorded as `dirty`) |
| `--pack DIR` | `BEINGDB_PACK` | Export an already compiled pack instead (its source is then not recorded) |
| | `BEINGDB_OPAM_SWITCH` | opam switch with native BeingDB's dependencies (default: the switch opam selects in `../beingdb`) |

Requirements: BeingDB checked out at `../beingdb` (the `native/vendor`
symlinks point there), opam, and native BeingDB's dependencies (Irmin) in an
opam switch, for example `(cd ../beingdb && opam install . --deps-only)`.
This repository's own switch does not need Irmin.

`npm test` fails, naming `npm run update-demo-data`, if the data file, its
metadata and the goldens do not agree. Artefacts in other repositories that
pin the fingerprint are not updated by this command; when it reports a
changed fingerprint, regenerate them separately, for example the
[beingdb-webllm](https://github.com/jptmoore/beingdb-webllm) evaluation
question sets (`eval/questions*.json`).

The command wraps these steps, which can help with debugging. With a compiled
pack at `PACK` and native BeingDB's opam switch `SWITCH`:

```sh
beingdb export --pack PACK -o data/rewind.browser.json
beingdb serve --pack PACK --port 8091 &
node fixtures/make_golden.mjs http://localhost:8091
BEINGDB_PACK=PACK opam exec --switch=SWITCH -- dune test --root native   # Irmin Pack vs export parity
```

Only `npm run update-demo-data` writes `data/rewind.browser.meta.json`, so
after manual steps, run it (with `--pack PACK`) to bring all three files back
in line.

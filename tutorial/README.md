# BeingDB browser tutorial

A zero-install, interactive BeingDB tutorial. Open the page and the real
BeingDB query engine (compiled to WebAssembly) loads in the browser together
with the REWIND interview dataset; participants can start querying within a
minute. There is no server, no account and nothing to install, which suits
workshops, demonstrations and first contact with BeingDB.

It is derived from the native tutorial,
[`beingdb/docs/tutorial.md`](https://github.com/jptmoore/beingdb/blob/main/docs/tutorial.md),
and uses the same dataset, examples and expected results.

**Live:** <https://jptmoore.github.io/beingdb-wasm/tutorial/>

Everything runs in the browser: queries execute locally in WebAssembly and
are never sent anywhere. The site is static HTML, CSS, JavaScript, one `.wasm`
module and the REWIND data, with no backend, analytics or third-party scripts.

## Run it

From the repository root, with Node >= 22 and nothing else installed:

```sh
npm run dev                # serve the tutorial with the prebuilt runtime and bundled data
```

Then open <http://localhost:8000/beingdb-wasm/tutorial/>. The local server
uses the same base path as GitHub Pages, so path problems show up locally.
Opening `index.html` straight from disk does not work, because the page fetches
its lessons and data.

| Command | What it does |
|---|---|
| `npm run dev` | Assemble `dist/site/` from `tutorial/`, the committed prebuilt runtime (`prebuilt/`) and the bundled dataset, and serve it at `http://localhost:8000/beingdb-wasm/` |
| `npm run tutorial` | Build the runtime from source (needs the OCaml setup in the main [README](../README.md#build-from-source)), then serve `dist/site/` |
| `npm test` | `dune test`: WASM parity, lesson checks (built and prebuilt runtime), native unit tests; then the bundle check |
| `npm run build:tutorial` | Release build (one WASM module, which Safari requires), then assemble `dist/site/` |
| `npm run verify:tutorial` | Check `dist/site/` in headless Chrome under `/beingdb-wasm/` (see below) |
| `npm run deploy` | Run the GitHub Pages workflow on `main` (needs `gh`) |

During development, `dune build` followed by
`python3 -m http.server 8000 -d _build/default` and
<http://localhost:8000/tutorial/> also works.

## Deploy

The site is built and published by GitHub Actions
([`.github/workflows/pages.yml`](../.github/workflows/pages.yml)):

- **Deployment is manual.** `npm run deploy` (or "Run workflow" on `main` in
  the Actions tab) runs the tests, builds `dist/site/`, verifies it, deploys
  it to GitHub Pages, then checks the live site in a fresh browser. Pushes to
  `main` do not deploy, so unrelated work never republishes the tutorial;
  deploy when a tutorial change is ready.
- **Pull requests**, and manual runs on other branches, build and verify
  only.

`dist/site/` keeps the build layout, so every URL in the tutorial stays
relative and works under any base path:

```
index.html                       redirects to tutorial/
tutorial/                        page, scripts, styles, lessons/*.json
web/main.bc.wasm.js              WASM loader (loads its .wasm relative to itself)
web/main.bc.wasm.assets/*.wasm   BeingDB runtime
web/rewind.browser.json          REWIND data
```

`npm run verify:tutorial` (also run in CI) serves `dist/site/` under
`/beingdb-wasm/` with nothing outside that path, like GitHub Pages, and checks
that the required files exist, the page code has no localhost or
root-relative URLs, the runtime and data load, a lesson query and a join
return the expected rows, every request stays under the base path, and the
`.wasm` is served as `application/wasm`. `node scripts/site.mjs verify --url
https://jptmoore.github.io/beingdb-wasm/` runs the same browser checks against
the live site.

## How it works

```
index.html -> format.js, ui.js, app.js -> ../web/main.bc.wasm.js (BeingDB runtime)
           -> ../web/rewind.browser.json   BeingDB.load(...)
           -> lessons/index.json, lessons/*.json
```

- **The runtime** is the existing `beingdb-wasm` build (`web/main.ml`). The
  page calls only its JavaScript API: `load`, `query`, `predicates`,
  `validate`, `diagnose` and `explain`. Parsing, validation, execution,
  diagnostics, proven repairs and query plans all come from BeingDB's own
  code; responses have the same shape as the native server's `POST /query`
  and `GET /predicates?detailed=true`.
- **`ui.js`** renders editors, result tables, schema browsing and BeingDB's
  messages; it is shared with the [explorer](../explorer/). It does not
  interpret queries. "Apply repair" loads BeingDB's `repair.query` into the
  editor; the predicate filter is a plain substring filter over
  `predicates()`.
- **`app.js`** renders lessons and navigation.
- **`format.js`** contains presentation helpers (response classification,
  escaping, literal formatting) shared by the page and the Node test.
- **Lessons** are data, not code: one JSON file per lesson in `lessons/`,
  ordered by `lessons/index.json`.

## The data

The tutorial loads the bundled REWIND dataset, `data/rewind.browser.json`, the
same data the rest of this repository uses and tests. Nothing is duplicated:
dune (or `npm run dev`) copies it next to the runtime, and the tutorial
fetches it from `../web/rewind.browser.json`.

| | |
|---|---|
| Source | [jptmoore/beingdb-rewind-interviews](https://github.com/jptmoore/beingdb-rewind-interviews), `predicates/` |
| Revision, size, fingerprint | recorded in [`data/rewind.browser.meta.json`](../data/rewind.browser.meta.json) |

The fingerprint is BeingDB's `environmentFingerprint`, computed from the loaded
data. It is shown in every response, and the tests check that it matches the
goldens and the metadata before running any lesson.

> **About the data.** The facts were extracted from interview transcripts by a
> language model. They are a research artifact, not verified catalogue
> metadata. Results mean "this relationship is recorded in the dataset", not
> "this is historically complete or correct". The tutorial's first lesson says
> so too.

### Updating the data

```sh
npm run update-demo-data
```

regenerates the dataset, its metadata and the goldens together from the
REWIND facts and runs every test (see the main README,
[The bundled REWIND dataset](../README.md#the-bundled-rewind-dataset)).
The tutorial test fails on any lesson whose `expect` block no longer matches
the data; fix those lessons (and keep `beingdb/docs/tutorial.md` in step).

## Lessons

| # | Lesson | Covers |
|---|--------|--------|
| 1 | Welcome | The dataset, the data caveat, a first Run |
| 2 | Explore the vocabulary | Predicate list (`:predicates`) |
| 3 | Describe a predicate | Roles, types, counts, examples (`:describe`) |
| 4 | Your first query | `find`/`where`, variables, `order by`, `limit` |
| 5 | Constants and variables | Constants, `_`, `distinct`, literal types |
| 6 | Joins | Shared variables, chains, filtering mixed positions |
| 7 | Self-joins and paths | Same predicate twice, reciprocity, multi-hop, connectivity |
| 8 | Filtering | Comparisons, `between`, type rules, `contains` |
| 9 | optional | Missing information, `null`, several optional blocks |
| 10 | either / or | Alternatives, branches with comparisons |
| 11 | not | Absence, safe negation |
| 12 | Counting | `count`, grouping, counting zero |
| 13 | When things go wrong | Errors, `unknown_constant`, `provablyEmpty`, repairs, diagnose, explain |
| 14 | Putting it together | Two capstones, four exercises with solutions, a playground |

A lesson file looks like this:

```json
{
  "title": "Joins",
  "intro": ["Paragraph with `code` and **bold**.", {"note": "A callout."}],
  "steps": [
    {
      "question": "What media did Kevin Atherton's works use?",
      "query": "find Work, Medium\nwhere\n  created_by(Work, kevin_atherton)\n  uses_medium(Work, Medium)",
      "notes": ["Shown under the result."],
      "try": ["Suggested change."],
      "expect": { "total": 6 }
    }
  ]
}
```

- **Prose blocks** (`intro`, `notes`): a string is a paragraph; `{"list": [...]}`,
  `{"table": {"head": [...], "rows": [[...]]}}`, `{"note": "..."}` and
  `{"code": "..."}` are also available. Inline formatting is limited to
  `` `code` ``, `**bold**` and `[text](https://...)`.
- **Step kinds**: `query` (default), `exercise` (`query` is the starter, plus a
  `solution`), `predicates` (the predicate browser), `describe` (with
  `predicate`) and `text`.
- **`action`**: `execute` (default), `diagnose`, `explain` or `validate`; sets
  the step's primary button. All four are always available.
- **`expect`** is checked by the test and never shown: `total`, `rows`,
  `firstRows`, `sortedRows`, `invalid` (error code), `diagnostic`,
  `provablyEmpty`, `repair`, `plan` (plan-text substring), or, for schema
  steps, `predicates`/`has` and `roles`/`types`.

## Tests

```sh
npm test        # or: dune test
```

`web/tutorial.cjs` loads the same WASM build and data in Node (once with the
fresh build and once with the prebuilt runtime in `prebuilt/`) and checks that:

- the runtime initialises and exposes the tutorial's API;
- the dataset loads, with the expected fingerprint, predicates and facts;
- predicate introspection returns the roles, types, counts and examples the
  schema lessons rely on;
- every runnable step (and every exercise solution) returns what its `expect`
  block says, and every proven repair runs;
- unfinished exercise starters and malformed input (empty, unbalanced,
  non-ASCII, oversized) produce structured errors from all four actions
  without throwing, and the runtime keeps working afterwards;
- the presentation helpers escape HTML and reject non-HTTP links.

It lives in `web/` next to the other Node tests because the WASM loader
resolves its assets relative to the main script (`web/runtime.cjs` points
that at whichever runtime is under test).

## Relationship to the native tutorial

The browser tutorial is shorter and is aimed at workshops (30 to 60 minutes).
It keeps the native tutorial's concepts, order, examples and data caveat, and
leaves out what only exists because of the command-line workflow: installing,
`beingdb clone`/`compile`/`pull`, the REPL, query files and the HTTP server.
For those, and for the complete query language, see the native
[tutorial](https://github.com/jptmoore/beingdb/blob/main/docs/tutorial.md)
and [query language reference](https://github.com/jptmoore/beingdb/blob/main/docs/query-language.md).

## Limitations

- The whole export is fetched (about 680 KB, roughly 215 KB gzipped; the
  whole site is about 1.1 MB) and held
  in memory. Fine for this dataset; not designed for large packs.
- There is no query timeout in the browser. The engine's row and scan limits
  still apply, so runaway queries fail with `result_too_large` or
  `scan_limit_exceeded` instead.
- Progress (lessons marked ✓) is stored in the browser's `localStorage` only.
- Edits are not saved: reloading a lesson restores its original queries.
- The dataset is fixed at build time. Loading other repositories, IIIF
  integration and LLM assistance are out of scope for now.

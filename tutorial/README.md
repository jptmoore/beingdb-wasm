# BeingDB browser tutorial

A zero-install, interactive BeingDB tutorial. Open the page and the real
BeingDB query engine (compiled to WebAssembly) loads in the browser together
with the REWIND interview dataset; participants can start querying within a
minute. There is no server, no account and nothing to install, which suits
workshops, demonstrations and first contact with BeingDB.

It is derived from the native tutorial,
[`beingdb/docs/tutorial.md`](https://github.com/jptmoore/beingdb/blob/main/docs/tutorial.md),
and uses the same dataset, examples and expected results.

## Run it

From the repository root (see the main [README](../README.md#install) for the
one-time opam setup):

```sh
dune build --profile release
python3 -m http.server 8000 -d _build/default
```

Then open <http://localhost:8000/tutorial/>.

Use the release profile when serving to other people: it links a single WASM
module, which Safari requires. A plain `dune build` works in Chrome and
Firefox. Any static file server works in place of `python3 -m http.server`;
opening `index.html` directly from disk does not, because the page fetches its
lessons and data.

To publish the tutorial, copy `_build/default/tutorial/` and
`_build/default/web/` (the page loads the runtime and data from `../web/`) to
any static host, keeping them side by side.

## How it works

```
index.html -> format.js, app.js -> ../web/main.bc.wasm.js (BeingDB runtime)
           -> ../web/rewind.browser.json   BeingDB.load(...)
           -> lessons/index.json, lessons/*.json
```

- **The runtime** is the existing `beingdb-wasm` build (`web/main.ml`). The
  page calls only its JavaScript API: `load`, `query`, `predicates`,
  `validate`, `diagnose` and `explain`. Parsing, validation, execution,
  diagnostics, proven repairs and query plans all come from BeingDB's own
  code; responses have the same shape as the native server's `POST /query`
  and `GET /predicates?detailed=true`.
- **`app.js`** renders lessons, editors, result tables, schema browsing and
  BeingDB's messages. It does not interpret queries. "Apply repair" loads
  BeingDB's `repair.query` into the editor; the predicate filter is a plain
  substring filter over `predicates()`.
- **`format.js`** contains presentation helpers (response classification,
  escaping, literal formatting) shared by the page and the Node test.
- **Lessons** are data, not code: one JSON file per lesson in `lessons/`,
  ordered by `lessons/index.json`.

## The data

The tutorial loads `data/rewind.browser.json`, the same export the rest of
this repository uses and tests. Nothing is duplicated: dune copies it into
`_build/default/web/`, and the tutorial fetches it from there.

| | |
|---|---|
| Source | [jptmoore/beingdb-rewind-interviews](https://github.com/jptmoore/beingdb-rewind-interviews), `predicates/` |
| Revision | commit [`419336f`](https://github.com/jptmoore/beingdb-rewind-interviews/commit/419336fde76716895f007e843ed58f57bc818bd4) |
| Size | 168 predicates, 1,842 facts |
| Fingerprint | `sha256:72f26c197b218529990de9cdf11da453d667020f693dbc4ba5398aa4ac1ed01d` |

The fingerprint is BeingDB's `environmentFingerprint` for the compiled data.
It is shown in every response, and the tests check that it matches before
running any lesson.

> **About the data.** The facts were extracted from interview transcripts by a
> language model. They are a research artifact, not verified catalogue
> metadata. Results mean "this relationship is recorded in the dataset", not
> "this is historically complete or correct". The tutorial's first lesson says
> so too.

### Updating the data

With a native BeingDB install (any switch that builds `beingdb`; the main
README calls it `5.4.0`):

```sh
beingdb clone https://github.com/jptmoore/beingdb-rewind-interviews.git --git /tmp/rewind_git
beingdb compile --git /tmp/rewind_git --pack /tmp/rewind_pack
opam exec --switch=5.4.0 -- dune exec --root native ./export_browser.exe -- \
  --pack /tmp/rewind_pack -o data/rewind.browser.json
```

Then re-record the goldens (`fixtures/make_golden.mjs`, see the main README),
update the revision and fingerprint above, and run `dune test`. The tutorial
test fails on any lesson whose `expect` block no longer matches the data; fix
those lessons (and keep `beingdb/docs/tutorial.md` in step).

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
dune test
```

`web/tutorial.cjs` loads the same WASM build and data in Node and checks that:

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
resolves its assets relative to the main script.

## Relationship to the native tutorial

The browser tutorial is shorter and is aimed at workshops (30 to 60 minutes).
It keeps the native tutorial's concepts, order, examples and data caveat, and
leaves out what only exists because of the command-line workflow: installing,
`beingdb clone`/`compile`/`pull`, the REPL, query files and the HTTP server.
For those, and for the complete query language, see the native
[tutorial](https://github.com/jptmoore/beingdb/blob/main/docs/tutorial.md)
and [query language reference](https://github.com/jptmoore/beingdb/blob/main/docs/query-language.md).

## Limitations

- The whole export is fetched (about 680 KB, roughly 215 KB gzipped) and held
  in memory. Fine for this dataset; not designed for large packs.
- There is no query timeout in the browser. The engine's row and scan limits
  still apply, so runaway queries fail with `result_too_large` or
  `scan_limit_exceeded` instead.
- Progress (lessons marked ✓) is stored in the browser's `localStorage` only.
- Edits are not saved: reloading a lesson restores its original queries.
- The dataset is fixed at build time. Loading other repositories, IIIF
  integration and LLM assistance are out of scope for now.

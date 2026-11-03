#!/usr/bin/env node
// Static sites for BeingDB WASM. No dependencies.
//
//   node scripts/site.mjs bundle --data FILE [--config FILE] [--title T] [--out DIR]
//                                          a deployable explorer for a `beingdb export` file, using the
//                                          committed prebuilt runtime (default --out dist/explorer)
//   node scripts/site.mjs dev [--port N]   assemble dist/site/ from the committed prebuilt runtime and
//                                          bundled dataset (no OCaml toolchain needed), then serve it
//   node scripts/site.mjs build            dune release build -> dist/site/
//   node scripts/site.mjs serve [--port N] serve dist/site/ under the Pages base path
//   node scripts/site.mjs serve --dir DIR  serve DIR (e.g. a bundle) at /
//   node scripts/site.mjs verify           check dist/site/ in headless Chrome under the base path
//   node scripts/site.mjs verify --url U   check a deployed site, e.g. https://jptmoore.github.io/beingdb-wasm/
//   node scripts/site.mjs deploy           trigger the GitHub Pages workflow on main (needs gh)
//   node scripts/site.mjs test             dune test, then check prebuilt/ and the bundled dataset
//
// dist/site/ (this repository's GitHub Pages site) mirrors the dune build
// layout, so every URL stays relative and works under any base path:
//
//   index.html                      redirect to tutorial/
//   tutorial/                       the tutorial page and lessons
//   explorer/                       the explorer (see bundle) over the REWIND dataset
//   web/main.bc.wasm.js             BeingDB WASM loader (finds its .wasm relative to itself)
//   web/main.bc.wasm.assets/*.wasm  BeingDB runtime (release build: one module)
//   web/rewind.browser.json         bundled REWIND dataset
//
// A bundle (and dist/site/explorer/) is self-contained:
//
//   index.html, explorer.js, ui.js, format.js, style.css
//   beingdb.json                    title, description, example queries and the data URL
//   runtime/                        BeingDB WASM runtime
//   data/<file>                     the export (bundle only)

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "_build", "default");
const PREBUILT = join(ROOT, "prebuilt");
const DIST = join(ROOT, "dist", "site");
// GitHub Pages project site: https://jptmoore.github.io/beingdb-wasm/
const PAGES_BASE = "/beingdb-wasm/";
const WORKFLOW = "pages.yml";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

const fail = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};
const has = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed`);
};
const output = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
// Use the repository's opam switch when opam is available (local dev and CI).
const dune = (...args) => (has("opam") ? run("opam", ["exec", "--", "dune", ...args]) : run("dune", args));

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const posix = (p) => p.split(sep).join("/");

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ---- build ------------------------------------------------------------------

const REDIRECT = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>BeingDB tutorial</title>
  <link rel="icon" href="data:,">
  <meta http-equiv="refresh" content="0; url=tutorial/">
</head>
<body>
  <p><a href="tutorial/">Open the BeingDB tutorial</a></p>
</body>
</html>
`;

// dist/site/ from a tutorial directory, a directory holding the WASM runtime
// (main.bc.wasm.js and main.bc.wasm.assets/) and the REWIND dataset.
function assemble({ tutorial, runtime, data }) {
  rmSync(DIST, { recursive: true, force: true });
  const copy = (from, to) => {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    chmodSync(to, 0o644);
  };
  const pick = (dir, to, keep) =>
    walk(dir)
      .filter((f) => keep(posix(relative(dir, f))))
      .forEach((f) => copy(f, join(DIST, to, relative(dir, f))));

  pick(tutorial, "tutorial", (p) => /^(index\.html|[^/]+\.js|[^/]+\.css|lessons\/[^/]+\.json)$/.test(p));
  pick(runtime, "web", (p) => p === "main.bc.wasm.js" || /^main\.bc\.wasm\.assets\/[^/]+\.wasm$/.test(p));
  copy(data, join(DIST, "web", "rewind.browser.json"));
  writeExplorer(join(DIST, "explorer"), runtime, JSON.parse(readFileSync(join(ROOT, "explorer", "beingdb.json"), "utf8")));
  writeFileSync(join(DIST, "index.html"), REDIRECT);
  report(DIST);
}

// The explorer page, its shared UI (from tutorial/), a runtime and beingdb.json.
function writeExplorer(out, runtime, config) {
  const copy = (from, to) => {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    chmodSync(to, 0o644);
  };
  for (const f of ["index.html", "explorer.js"]) copy(join(ROOT, "explorer", f), join(out, f));
  for (const f of ["ui.js", "format.js", "style.css"]) copy(join(ROOT, "tutorial", f), join(out, f));
  for (const f of walk(runtime)) {
    const p = posix(relative(runtime, f));
    if (p === "main.bc.wasm.js" || /^main\.bc\.wasm\.assets\/[^/]+\.wasm$/.test(p)) copy(f, join(out, "runtime", p));
  }
  writeFileSync(join(out, "beingdb.json"), JSON.stringify(config, null, 2) + "\n");
}

// Load an export with a runtime in Node; returns its load summary.
function checkData(runtime, data) {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "check-data.cjs"), join(runtime, "main.bc.wasm.js"), data], { encoding: "utf8" });
  if (r.status !== 0) fail(`${data} does not load in the BeingDB WASM runtime: ${(r.stderr || r.stdout).trim()}`);
  return JSON.parse(r.stdout);
}

// A deployable explorer for one `beingdb export` file, from the committed prebuilt runtime.
function bundle() {
  // `npm run` changes into the repository; resolve paths against where it was invoked.
  const here = (p) => p && resolve(process.env.INIT_CWD || process.cwd(), p);
  const data = here(option("--data"));
  if (!data) fail("usage: npm run bundle -- --data FILE [--config beingdb.json] [--title TITLE] [--out DIR]\n  FILE is written by `beingdb export --pack ./pack_store -o FILE`");
  if (!existsSync(data) || !statSync(data).isFile()) fail(`--data ${data} is not a file`);
  const configFile = here(option("--config"));
  if (configFile && !existsSync(configFile)) fail(`--config ${configFile} does not exist`);
  const out = here(option("--out")) || join(ROOT, "dist", "explorer");
  // Never delete a directory this command did not write.
  if (existsSync(out) && readdirSync(out).length && !(existsSync(join(out, "beingdb.json")) && existsSync(join(out, "runtime"))))
    fail(`--out ${out} exists and is not a previous bundle; choose an empty or new directory`);
  if (!existsSync(join(PREBUILT, "main.bc.wasm.js"))) fail("prebuilt/main.bc.wasm.js is missing");

  const summary = checkData(PREBUILT, data);
  const config = configFile ? JSON.parse(readFileSync(configFile, "utf8")) : {};
  const name = basename(data);
  config.title = option("--title", config.title || name.replace(/(\.browser)?\.json$/, ""));
  config.data = `data/${name}`;

  rmSync(out, { recursive: true, force: true });
  writeExplorer(out, PREBUILT, config);
  mkdirSync(join(out, "data"), { recursive: true });
  cpSync(data, join(out, "data", name));
  chmodSync(join(out, "data", name), 0o644);
  report(out);
  console.log(`\n${config.title}: ${summary.predicates} predicates, ${summary.facts} facts (fingerprint ${summary.environmentFingerprint})`);
  console.log(`Publish ${out}/ on any static web host (GitHub Pages, Netlify, S3, ...).`);
  console.log(`Preview: npm run preview -- ${out}`);
}

function build() {
  // Release profile: one linked WASM module (Safari needs it).
  dune("build", "--profile", "release", "@tutorial/page");
  assemble({ tutorial: join(BUILD, "tutorial"), runtime: join(BUILD, "web"), data: join(BUILD, "web", "rewind.browser.json") });
}

// The committed prebuilt runtime, bundled dataset and tutorial sources: no
// OCaml, Binaryen or BeingDB checkout needed.
function dev() {
  if (!existsSync(join(PREBUILT, "main.bc.wasm.js"))) fail("prebuilt/main.bc.wasm.js is missing");
  assemble({ tutorial: join(ROOT, "tutorial"), runtime: PREBUILT, data: join(ROOT, "data", "rewind.browser.json") });
  serve();
}

function report(dir) {
  const files = walk(dir).sort();
  let total = 0;
  for (const f of files) {
    const size = statSync(f).size;
    total += size;
    console.log(`  ${posix(relative(dir, f)).padEnd(48)} ${(size / 1024).toFixed(1).padStart(8)} KB`);
  }
  console.log(`${dir.startsWith(ROOT + sep) ? posix(relative(ROOT, dir)) : dir}: ${files.length} files, ${(total / 1024).toFixed(0)} KB`);
}

// ---- serve ------------------------------------------------------------------

// Serve dir under base, like GitHub Pages: nothing exists outside base.
function staticServer(dir, base) {
  const requests = [];
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    requests.push(path);
    if (path === "/" && base !== "/") return res.writeHead(302, { Location: base }).end();
    if (!path.startsWith(base)) return res.writeHead(404).end("Not found (outside the site base path)");
    let file = normalize(join(dir, path.slice(base.length)));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!path.endsWith("/")) return res.writeHead(301, { Location: `${path}/` }).end();
      file = join(file, "index.html");
    }
    if (!existsSync(file)) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(readFileSync(file));
  });
  return { server, requests };
}

function serve() {
  const port = Number(option("--port", process.env.PORT || 8000));
  const dir = option("--dir");
  if (dir) {
    const root = resolve(process.env.INIT_CWD || process.cwd(), dir);
    if (!existsSync(join(root, "index.html"))) fail(`${dir}/index.html is missing`);
    staticServer(root, "/").server.listen(port, "127.0.0.1", () => console.log(`Serving ${dir} at http://localhost:${port}/   (Ctrl-C to stop)`));
    return;
  }
  if (!existsSync(join(DIST, "index.html"))) fail("dist/site is missing; run `npm run build:tutorial` first");
  const { server } = staticServer(DIST, PAGES_BASE);
  server.listen(port, "127.0.0.1", () => {
    console.log(`Serving dist/site under ${PAGES_BASE}, as on GitHub Pages.`);
    console.log(`Tutorial: http://localhost:${port}${PAGES_BASE}tutorial/   (Ctrl-C to stop)`);
    console.log(`Explorer: http://localhost:${port}${PAGES_BASE}explorer/`);
  });
}

// ---- verify -----------------------------------------------------------------

function staticChecks() {
  const required = [
    "index.html",
    "tutorial/index.html",
    "tutorial/app.js",
    "tutorial/format.js",
    "tutorial/ui.js",
    "tutorial/style.css",
    "tutorial/lessons/index.json",
    "web/main.bc.wasm.js",
    "web/rewind.browser.json",
    "explorer/index.html",
    "explorer/explorer.js",
    "explorer/ui.js",
    "explorer/format.js",
    "explorer/style.css",
    "explorer/beingdb.json",
    "explorer/runtime/main.bc.wasm.js",
  ];
  for (const f of required) if (!existsSync(join(DIST, f))) fail(`dist/site/${f} is missing`);
  const assets = join(DIST, "web", "main.bc.wasm.assets");
  const wasm = existsSync(assets) ? readdirSync(assets).filter((f) => f.endsWith(".wasm")) : [];
  if (wasm.length === 0) fail("no .wasm in dist/site/web/main.bc.wasm.assets");
  for (const id of JSON.parse(readFileSync(join(DIST, "tutorial/lessons/index.json"), "utf8")))
    if (!existsSync(join(DIST, "tutorial/lessons", `${id}.json`))) fail(`lesson ${id} is missing`);

  // No localhost, root-relative or third-party script/style/fetch URLs in the page code.
  for (const f of walk(DIST).filter((f) => /\.(html|js|css)$/.test(f))) {
    const text = readFileSync(f, "utf8");
    const name = posix(relative(DIST, f));
    if (/localhost|127\.0\.0\.1/.test(text)) fail(`${name} mentions localhost`);
    if (/\b(?:src|href)\s*=\s*["']\/(?!\/)/.test(text)) fail(`${name} has a root-relative src/href`);
    if (/<script[^>]+src\s*=\s*["'](?:https?:)?\/\//i.test(text) || /<link[^>]+href\s*=\s*["'](?:https?:)?\/\//i.test(text))
      fail(`${name} loads a third-party script or stylesheet`);
    if (/fetch\(\s*["'`](?:https?:|\/)/.test(text)) fail(`${name} fetches an absolute URL`);
  }
  console.log(`static checks passed: ${required.length} required files, ${wasm.length} wasm module(s), no localhost/absolute asset URLs`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);
  return candidates.find((c) => (c.includes("/") ? existsSync(c) : has(c)));
}

// Minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
async function launchChrome() {
  const chrome = findChrome();
  if (!chrome) fail("Chrome/Chromium not found (set CHROME=/path/to/chrome)");
  const profile = mkdtempSync(join(tmpdir(), "beingdb-site-"));
  const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "--remote-debugging-port=0"];
  if (process.env.CI) args.push("--no-sandbox");
  const proc = spawn(chrome, [...args, "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) fail("Chrome did not start");
  await sleep(100);
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((ok, err) => {
    ws.onopen = ok;
    ws.onerror = err;
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method) listeners.forEach((l) => l(m));
  };
  const send = (method, params = {}) =>
    new Promise((ok, err) => {
      pending.set(++id, (m) => (m.error ? err(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  const close = async () => {
    ws.close();
    proc.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  };
  return { send, on: (f) => listeners.push(f), close };
}

// expectedFingerprint: the bundled dataset's, when verifying a local build.
async function browserChecks(siteUrl, expectedFingerprint) {
  const base = new URL(siteUrl);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const chrome = await launchChrome();
  const requests = [];
  const responses = new Map();
  const problems = [];
  chrome.on(({ method, params }) => {
    if (method === "Network.requestWillBeSent") requests.push(params.request.url);
    if (method === "Network.responseReceived") responses.set(params.response.url, params.response);
    if (method === "Network.loadingFailed") problems.push(`request failed: ${params.errorText} (${params.type})`);
    if (method === "Runtime.exceptionThrown") problems.push(`exception: ${params.exceptionDetails.exception?.description || params.exceptionDetails.text}`);
    if (method === "Runtime.consoleAPICalled" && params.type === "error") problems.push(`console.error: ${params.args.map((a) => a.value ?? a.description).join(" ")}`);
    if (method === "Log.entryAdded" && params.entry.level === "error") problems.push(`log: ${params.entry.text} ${params.entry.url || ""}`);
  });
  const evaluate = async (expression) => (await chrome.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  const waitFor = async (expression, what, ms = 30000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) {
      const v = await evaluate(expression).catch(() => null);
      if (v) return v;
    }
    throw new Error(`timed out waiting for ${what}${problems.length ? `\n  ${problems.join("\n  ")}` : ""}`);
  };
  try {
    for (const domain of ["Network", "Runtime", "Page", "Log"]) await chrome.send(`${domain}.enable`);
    await chrome.send("Network.setCacheDisabled", { cacheDisabled: true });
    // Start at the site root: it must open the tutorial.
    await chrome.send("Page.navigate", { url: base.href });
    const status = await waitFor(`(() => { const s = document.querySelector('#status')?.textContent || ''; return /predicates/.test(s) && s; })()`, "the WASM runtime and REWIND data");
    const page = await evaluate("location.href");
    if (new URL(page).pathname !== `${base.pathname}tutorial/`) throw new Error(`the site root did not open the tutorial (at ${page})`);
    const lessons = await evaluate("document.querySelectorAll('#nav a').length");
    if (!lessons) throw new Error("no lessons loaded");
    // Run the first lesson's query through the UI, then a join through the runtime API.
    await evaluate("document.querySelector('section.step button.primary').click()");
    const summary = await waitFor("document.querySelector('.output .summary')?.textContent", "the first query result");
    if (!/^10 rows/.test(summary)) throw new Error(`first query returned "${summary}"`);
    const join = await evaluate(`JSON.parse(BeingDB.query("find Work, Medium\\nwhere\\n  created_by(Work, kevin_atherton)\\n  uses_medium(Work, Medium)")).total`);
    if (join !== 6) throw new Error(`join query returned ${join} rows, expected 6`);
    const fingerprint = await evaluate("JSON.parse(BeingDB.predicates()).environmentFingerprint");
    if (expectedFingerprint && fingerprint !== expectedFingerprint)
      throw new Error(`the browser loaded data with fingerprint ${fingerprint}, but data/rewind.browser.meta.json has ${expectedFingerprint}`);

    // The explorer: configured data, first example query through the UI.
    await chrome.send("Page.navigate", { url: `${base.href}explorer/` });
    await waitFor(`(() => { const s = document.querySelector('#status')?.textContent || ''; return /predicates/.test(s) && document.querySelector('section.step button.primary') && s; })()`, "the explorer");
    await evaluate("document.querySelector('section.step button.primary').click()");
    const explorer = await waitFor("document.querySelector('.output .summary')?.textContent", "the explorer query result");
    if (!/^17 rows/.test(explorer)) throw new Error(`explorer query returned "${explorer}"`);
    await sleep(300);

    // Every request stays on the site, under the base path, and succeeds.
    for (const url of requests) {
      if (url.startsWith("data:")) continue;
      const u = new URL(url);
      if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname)) problems.push(`request outside the site: ${url}`);
    }
    for (const [url, r] of responses) if (r.status >= 400) problems.push(`HTTP ${r.status}: ${url}`);
    const wasm = [...responses.values()].filter((r) => r.url.endsWith(".wasm"));
    if (wasm.length === 0) problems.push("no .wasm was loaded");
    for (const r of wasm) if (!/^application\/wasm/.test(r.mimeType)) problems.push(`${r.url} served as ${r.mimeType}, not application/wasm`);
    if (![...responses.keys()].some((u) => u.endsWith("/web/rewind.browser.json"))) problems.push("REWIND data was not loaded");
    if (problems.length) throw new Error(`\n  ${problems.join("\n  ")}`);
    console.log(`browser checks passed at ${base.href}`);
    console.log(`  ${status}`);
    console.log(`  ${lessons} lessons; first query: ${summary}; join: ${join} rows; explorer: ${explorer}`);
    console.log(`  fingerprint ${fingerprint}${expectedFingerprint ? " (matches data/rewind.browser.meta.json)" : ""}`);
    console.log(`  ${requests.length} requests, all under ${base.pathname}; wasm served as ${[...new Set(wasm.map((r) => r.mimeType))].join(", ")}`);
  } finally {
    await chrome.close();
  }
}

async function verify() {
  const url = option("--url");
  if (url) {
    // A fresh deployment can take a moment to reach the CDN.
    for (let attempt = 1; ; attempt++) {
      try {
        return await browserChecks(url);
      } catch (e) {
        if (attempt >= 5) fail(e.message);
        console.log(`attempt ${attempt} failed (${e.message.trim().split("\n")[0]}); retrying in 15 s`);
        await sleep(15000);
      }
    }
  }
  if (!existsSync(DIST)) fail("dist/site is missing; run `npm run build:tutorial` first");
  staticChecks();
  const { server, requests } = staticServer(DIST, PAGES_BASE);
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  try {
    const meta = JSON.parse(readFileSync(join(ROOT, "data", "rewind.browser.meta.json"), "utf8"));
    await browserChecks(`http://127.0.0.1:${server.address().port}${PAGES_BASE}`, meta.environmentFingerprint);
  } catch (e) {
    fail(e.message);
  } finally {
    server.close();
  }
  const outside = requests.filter((p) => !p.startsWith(PAGES_BASE));
  if (outside.length) fail(`requests outside ${PAGES_BASE}: ${outside.join(", ")}`);
}

// ---- deploy -----------------------------------------------------------------

function deploy() {
  if (!has("gh")) fail("the GitHub CLI (gh) is required: https://cli.github.com/ (or run the workflow from the repository's Actions tab)");
  const repo = output("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).stdout.trim();
  if (!repo) fail("could not determine the GitHub repository (is gh logged in?)");
  const pages = output("gh", ["api", `repos/${repo}/pages`, "--jq", ".build_type"]);
  if (pages.status !== 0 || pages.stdout.trim() !== "workflow")
    fail(`GitHub Pages must be set to deploy from GitHub Actions (one-time): https://github.com/${repo}/settings/pages > Build and deployment > Source: "GitHub Actions"`);
  run("git", ["fetch", "--quiet", "origin", "main"]);
  const head = output("git", ["rev-parse", "HEAD"]).stdout.trim();
  const main = output("git", ["rev-parse", "origin/main"]).stdout.trim();
  if (head !== main) console.log(`note: the workflow deploys origin/main (${main.slice(0, 7)}), not your HEAD (${head.slice(0, 7)}); merge and push to deploy local changes.`);
  run("gh", ["workflow", "run", WORKFLOW, "--repo", repo, "--ref", "main"]);
  const [owner, name] = repo.split("/");
  console.log(`Deployment of main started: https://github.com/${repo}/actions/workflows/${WORKFLOW}`);
  console.log(`Site: https://${owner.toLowerCase()}.github.io/${name}/tutorial/`);
}

// ---- main -------------------------------------------------------------------

function test() {
  dune("test");
  run(process.execPath, [join(ROOT, "scripts", "maintain.mjs"), "check"]);
}

const commands = { bundle, dev, build, serve, verify, deploy, test };
const command = commands[process.argv[2]];
if (!command) fail(`usage: node scripts/site.mjs <${Object.keys(commands).join("|")}> [options]`);
await command();

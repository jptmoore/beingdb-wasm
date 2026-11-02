#!/usr/bin/env node
// Maintainer tasks for the bundled REWIND dataset and the prebuilt WASM runtime.
// Not needed to use or run BeingDB WASM (see README). No dependencies.
//
//   node scripts/maintain.mjs update-demo-data [--source URL|DIR] [--pack DIR]
//       Regenerate data/rewind.browser.json, data/rewind.browser.meta.json and
//       fixtures/rewind_golden.json together from the REWIND facts, then validate.
//       Needs native BeingDB (../beingdb) and an opam switch with its dependencies.
//   node scripts/maintain.mjs update-runtime [--allow-dirty]
//       Rebuild the release WASM runtime and refresh prebuilt/ (used by `npm run dev`).
//   node scripts/maintain.mjs check
//       Check prebuilt/ and the bundled dataset against their metadata (part of `npm test`).
//
// Environment:
//   REWIND_SOURCE        facts to compile: a Git URL or a local checkout
//                        (default: https://github.com/jptmoore/beingdb-rewind-interviews.git)
//   BEINGDB_PACK         use this already compiled pack instead of compiling REWIND_SOURCE
//   BEINGDB_OPAM_SWITCH  opam switch with native BeingDB's dependencies (Irmin)
//                        (default: the switch opam selects in ../beingdb)

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Fixed by the committed symlinks vendor/beingdb_runtime and native/vendor/*.
const BEINGDB = resolve(ROOT, "..", "beingdb");
const DATA = join(ROOT, "data", "rewind.browser.json");
const META = join(ROOT, "data", "rewind.browser.meta.json");
const GOLDEN = join(ROOT, "fixtures", "rewind_golden.json");
const PREBUILT = join(ROOT, "prebuilt");
const RUNTIME_MANIFEST = join(PREBUILT, "runtime.json");
const WORKFLOW = join(ROOT, ".github", "workflows", "pages.yml");
const DEFAULT_SOURCE = "https://github.com/jptmoore/beingdb-rewind-interviews.git";

const NATIVE_ONLY =
  "Native BeingDB is only needed to regenerate the bundled REWIND dataset. You do not need it to use or run\n" +
  "BeingDB WASM: the repository ships a prebuilt dataset and runtime (see README, \"Run locally\": npm run dev).";

const fail = (msg) => {
  console.error(`\nerror: ${msg}`);
  process.exit(1);
};
const step = (msg) => console.log(`\n==> ${msg}`);
const posix = (p) => p.split(sep).join("/");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const writeJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + "\n");
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

function option(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const has = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;
const output = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts });
function run(cmd, args, { what, ...opts } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${what || `${cmd} ${args.join(" ")}`} failed`);
}

// This repository's (WASM) switch: the one opam selects here, as in scripts/site.mjs.
const wasm = (args, opts) => (has("opam") ? run("opam", ["exec", "--", ...args], opts) : run(args[0], args.slice(1), opts));

// opam switch selection must not leak from the caller's environment into ../beingdb.
const withoutSwitch = () => {
  const env = { ...process.env };
  delete env.OPAMSWITCH;
  return env;
};

function git(dir, args) {
  const r = output("git", ["-C", dir, ...args]);
  return r.status === 0 ? r.stdout.trim() : null;
}
const isDirty = (dir) => Boolean(git(dir, ["status", "--porcelain"]));
// Never record credentials or local filesystem paths.
const publicUrl = (url) => {
  if (!url) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.protocol === "file:" ? null : u.href;
  }
  return /^[^/]+@[^:]+:/.test(url) ? url : null; // scp-style git@host:owner/repo
};

// ---- runtime sources and the prebuilt runtime ----------------------------------

// Inputs that determine the WASM runtime: this repository's OCaml glue and the
// BeingDB runtime it vendors (vendor/beingdb_runtime -> ../beingdb/lib/runtime).
function runtimeSources() {
  const runtimeDir = join(ROOT, "vendor", "beingdb_runtime");
  if (!existsSync(join(runtimeDir, "dune"))) return null;
  const source = (f) => /\.mli?$/.test(f) || basename(f) === "dune";
  const files = [
    join(ROOT, "dune-project"),
    join(ROOT, "web", "main.ml"),
    ...walk(join(ROOT, "src")).filter(source),
    ...walk(runtimeDir).filter(source),
  ];
  const lines = files.map((f) => `${posix(relative(ROOT, f))}\0${sha256(readFileSync(f))}`).sort();
  return `sha256:${sha256(lines.join("\n"))}`;
}

function workflowBeingdbRef() {
  return readFileSync(WORKFLOW, "utf8").match(/^\s*BEINGDB_REF:\s*([0-9a-f]{40})\s*$/m)?.[1] ?? null;
}

function checkPrebuilt() {
  const problems = [];
  const refresh = "run `npm run update-runtime` and commit prebuilt/";
  if (!existsSync(RUNTIME_MANIFEST)) return [`prebuilt/runtime.json is missing; ${refresh}`];
  const manifest = readJson(RUNTIME_MANIFEST);
  const listed = Object.keys(manifest.files);
  const present = walk(PREBUILT)
    .map((f) => posix(relative(PREBUILT, f)))
    .filter((f) => f !== "runtime.json");
  for (const f of present) if (!listed.includes(f)) problems.push(`prebuilt/${f} is not listed in prebuilt/runtime.json; ${refresh}`);
  for (const [f, hash] of Object.entries(manifest.files)) {
    const file = join(PREBUILT, f);
    if (!existsSync(file)) problems.push(`prebuilt/${f} is missing; ${refresh}`);
    else if (`sha256:${sha256(readFileSync(file))}` !== hash) problems.push(`prebuilt/${f} does not match prebuilt/runtime.json; ${refresh}`);
  }
  const sources = runtimeSources();
  if (!sources) console.log("note: ../beingdb is not checked out; skipped the prebuilt runtime freshness check");
  else if (sources !== manifest.sources) {
    const at = git(BEINGDB, ["rev-parse", "HEAD"]);
    problems.push(
      `prebuilt/ is stale: it was built from BeingDB ${manifest.beingdb.commit.slice(0, 12)} and different runtime ` +
        `sources than the current tree (../beingdb at ${at ? at.slice(0, 12) : "unknown"}); ${refresh}`,
    );
  }
  const ref = workflowBeingdbRef();
  if (ref && ref !== manifest.beingdb.commit)
    problems.push(
      `prebuilt/ was built from BeingDB ${manifest.beingdb.commit.slice(0, 12)}, but .github/workflows/pages.yml builds the ` +
        `site from BEINGDB_REF ${ref.slice(0, 12)}; update BEINGDB_REF or ${refresh}`,
    );
  return problems;
}

// ---- the bundled dataset --------------------------------------------------------

function checkData() {
  const problems = [];
  const regenerate = "regenerate them together with `npm run update-demo-data`";
  if (!existsSync(META)) return [`data/rewind.browser.meta.json is missing; ${regenerate}`];
  const meta = readJson(META);
  if (sha256(readFileSync(DATA)) !== meta.sha256)
    problems.push(`data/rewind.browser.json does not match data/rewind.browser.meta.json (sha256); ${regenerate}`);
  const goldenFingerprint = readJson(GOLDEN).predicates.environmentFingerprint;
  if (goldenFingerprint !== meta.environmentFingerprint)
    problems.push(
      `fixtures/rewind_golden.json has fingerprint ${goldenFingerprint}, data/rewind.browser.meta.json has ` +
        `${meta.environmentFingerprint}; ${regenerate}`,
    );
  return problems;
}

function checkBundle() {
  const problems = [...checkPrebuilt(), ...checkData()];
  if (problems.length) throw new Error(`bundled artefacts are inconsistent:\n  ${problems.join("\n  ")}`);
  const meta = readJson(META);
  const runtime = readJson(RUNTIME_MANIFEST);
  console.log(
    `bundle check passed: prebuilt runtime (BeingDB ${runtime.beingdb.commit.slice(0, 12)}), ` +
      `REWIND dataset ${meta.environmentFingerprint} (${meta.predicates} predicates, ${meta.facts} facts)`,
  );
}

// ---- update-runtime -------------------------------------------------------------

function updateRuntime() {
  if (!runtimeSources())
    fail(
      "the BeingDB runtime sources are missing: clone BeingDB next to this repository\n" +
        "  git clone https://github.com/jptmoore/beingdb.git ../beingdb\n" +
        "Only maintainers need this; `npm run dev` uses the committed prebuilt runtime.",
    );
  const commit = git(BEINGDB, ["rev-parse", "HEAD"]);
  const dirty = isDirty(BEINGDB);
  if (dirty && !process.argv.includes("--allow-dirty"))
    fail("../beingdb has uncommitted changes, so the prebuilt runtime could not be reproduced; commit them or pass --allow-dirty");

  step("Building the release WASM runtime (one module, which Safari requires)");
  try {
    wasm(["dune", "build", "--profile", "release", "./web/main.bc.wasm.js"], { what: "dune build --profile release" });
  } catch (e) {
    fail(`${e.message}. Set up the OCaml/WASM toolchain first (README, "Development and testing").`);
  }
  const web = join(ROOT, "_build", "default", "web");
  const assets = readdirSync(join(web, "main.bc.wasm.assets")).filter((f) => f.endsWith(".wasm"));
  if (assets.length !== 1) fail(`expected one .wasm module from the release build, found ${assets.length}`);

  rmSync(PREBUILT, { recursive: true, force: true });
  const files = ["main.bc.wasm.js", `main.bc.wasm.assets/${assets[0]}`];
  for (const f of files) {
    mkdirSync(dirname(join(PREBUILT, f)), { recursive: true });
    cpSync(join(web, f), join(PREBUILT, f));
  }
  const version = (args) => {
    const r = has("opam") ? output("opam", ["exec", "--", ...args]) : output(args[0], args.slice(1));
    return r.status === 0 ? r.stdout.trim() : null;
  };
  writeJson(RUNTIME_MANIFEST, {
    description: "Prebuilt release BeingDB WASM runtime used by `npm run dev`. Written by `npm run update-runtime`; checked by `npm test`.",
    sources: runtimeSources(),
    beingdb: { repository: "https://github.com/jptmoore/beingdb.git", commit, dirty },
    toolchain: {
      ocaml: version(["ocamlc", "-version"]),
      wasm_of_ocaml: version(["wasm_of_ocaml", "--version"]),
      binaryen: version(["wasm-opt", "--version"])?.replace(/^wasm-opt version\s*/, "") ?? null,
    },
    files: Object.fromEntries(files.map((f) => [f, `sha256:${sha256(readFileSync(join(PREBUILT, f)))}`])),
  });
  console.log(`prebuilt/: ${files.map((f) => `${f} (${(statSync(join(PREBUILT, f)).size / 1024).toFixed(0)} KB)`).join(", ")}`);
  const ref = workflowBeingdbRef();
  if (ref && ref !== commit)
    console.log(`note: .github/workflows/pages.yml pins BEINGDB_REF ${ref.slice(0, 12)}; set it to ${commit} so CI builds the same runtime.`);
  console.log("Next: `npm test` (checks prebuilt/ against the goldens and lessons), then commit prebuilt/.");
}

// ---- update-demo-data -----------------------------------------------------------

function nativeSwitch() {
  if (!existsSync(join(BEINGDB, "bin")) || !existsSync(join(BEINGDB, "lib", "pack_unix")))
    fail(
      `native BeingDB was not found at ../beingdb (next to this repository).\n${NATIVE_ONLY}\n\n` +
        "To regenerate the dataset, clone it there and install its dependencies:\n" +
        "  git clone https://github.com/jptmoore/beingdb.git ../beingdb\n" +
        "  (cd ../beingdb && opam install . --deps-only)",
    );
  if (!has("opam")) fail(`opam is required to build native BeingDB (https://opam.ocaml.org/).\n${NATIVE_ONLY}`);
  const name = process.env.BEINGDB_OPAM_SWITCH || output("opam", ["switch", "show"], { cwd: BEINGDB, env: withoutSwitch() }).stdout.trim();
  const irmin = output("opam", ["list", `--switch=${name}`, "--installed", "--short", "irmin-pack"], { env: withoutSwitch() });
  if (!name || irmin.status !== 0 || irmin.stdout.trim() !== "irmin-pack")
    fail(
      `opam switch "${name || "?"}" does not have native BeingDB's dependencies (irmin-pack).\n${NATIVE_ONLY}\n\n` +
        "Install them into the switch you build BeingDB with, and select it with BEINGDB_OPAM_SWITCH if it is not\n" +
        "the one opam picks in ../beingdb:\n" +
        `  (cd ../beingdb && opam install --switch=${name || "SWITCH"} . --deps-only)\n` +
        "  BEINGDB_OPAM_SWITCH=SWITCH npm run update-demo-data",
    );
  return name;
}

async function freePort() {
  const server = createServer();
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const { port } = server.address();
  await new Promise((ok) => server.close(ok));
  return port;
}

// Record goldens from a native `beingdb serve` on the pack, via fixtures/make_golden.mjs.
// The server logs to a file: make_golden runs synchronously, so a pipe would fill and stall it.
async function recordGoldens(beingdb, pack, out, work) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const logFile = join(work, "serve.log");
  const fd = openSync(logFile, "w");
  const server = spawn(beingdb, ["serve", "--pack", pack, "--port", String(port)], { stdio: ["ignore", fd, fd] });
  closeSync(fd);
  const log = () => readFileSync(logFile, "utf8").split("\n").slice(-20).join("\n");
  let exited = false;
  server.on("exit", () => (exited = true));
  try {
    for (let ready = false, end = Date.now() + 60000; !ready; await sleep(250)) {
      if (exited) throw new Error(`beingdb serve exited:\n${log()}`);
      if (Date.now() > end) throw new Error(`beingdb serve did not start on ${base}:\n${log()}`);
      ready = await fetch(`${base}/predicates`).then((r) => r.ok, () => false);
    }
    run(process.execPath, [join(ROOT, "fixtures", "make_golden.mjs"), base, out], { what: "fixtures/make_golden.mjs" });
  } finally {
    server.kill("SIGTERM");
  }
}

function sourceProvenance(source, git_store) {
  // BeingDB compiles the Irmin store's "main" branch (its Git HEAD file names an empty "master").
  if (git_store) return { repository: publicUrl(source), commit: git(ROOT, ["--git-dir", join(git_store, ".git"), "rev-parse", "refs/heads/main"]) };
  const isRepo = git(source, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!isRepo) return { repository: null, commit: null, note: "local directory that is not a Git checkout" };
  return { repository: publicUrl(git(source, ["remote", "get-url", "origin"])), commit: git(source, ["rev-parse", "HEAD"]), dirty: isDirty(source) };
}

async function updateDemoData() {
  const packOption = option("--pack", process.env.BEINGDB_PACK);
  const source = option("--source", process.env.REWIND_SOURCE || DEFAULT_SOURCE);
  const localSource = !packOption && (existsSync(source) || /^(\.|\/|~)/.test(source));
  if (packOption && !existsSync(join(resolve(packOption), "store.control")))
    fail(`--pack/BEINGDB_PACK ${packOption} is not a compiled BeingDB pack (no store.control)`);
  if (localSource && !(existsSync(source) && statSync(source).isDirectory()))
    fail(`--source/REWIND_SOURCE ${source} is not a directory (pass a Git URL or a local checkout of the REWIND facts)`);

  const switchName = nativeSwitch();
  const native = (args, opts) => run("opam", ["exec", `--switch=${switchName}`, "--", ...args], { env: withoutSwitch(), ...opts });
  const previous = existsSync(META) ? readJson(META) : null;
  const work = mkdtempSync(join(tmpdir(), "beingdb-demo-data-"));
  let installed = false;
  try {
    step(`Building native BeingDB in ../beingdb (opam switch ${switchName})`);
    native(["dune", "build", "./bin/main.exe"], { cwd: BEINGDB, what: "building native BeingDB" });
    const beingdb = join(BEINGDB, "_build", "default", "bin", "main.exe");

    let pack, provenance;
    if (packOption) {
      pack = resolve(packOption);
      step(`Using the compiled pack ${packOption}`);
      provenance = { repository: null, commit: null, note: "exported from an existing compiled pack (--pack); source facts not recorded" };
    } else {
      const gitStore = join(work, "git_store");
      pack = join(work, "pack_store");
      if (localSource) {
        step(`Importing the REWIND facts from ${source}`);
        run(beingdb, ["import", "--input", resolve(source), "--git", gitStore], { what: "beingdb import" });
        provenance = sourceProvenance(resolve(source));
      } else {
        step(`Cloning the REWIND facts from ${publicUrl(source) ?? "the given URL"}`);
        run(beingdb, ["clone", source, "--git", gitStore], { what: "beingdb clone" });
        provenance = sourceProvenance(source, gitStore);
      }
      step("Compiling the facts into a pack");
      run(beingdb, ["compile", "--git", gitStore, "--pack", pack], { what: "beingdb compile" });
    }

    step("Exporting the pack as BeingDB browser data");
    const data = join(work, "rewind.browser.json");
    native(["dune", "exec", "--root", "native", "./export_browser.exe", "--", "--pack", pack, "-o", data], { what: "native/export_browser" });

    step("Recording goldens (and the environment fingerprint) from native beingdb serve");
    const golden = join(work, "rewind_golden.json");
    await recordGoldens(beingdb, pack, golden, work);

    const text = readFileSync(data);
    const exported = JSON.parse(text);
    const predicates = readJson(golden).predicates;
    const commit = git(BEINGDB, ["rev-parse", "HEAD"]);
    const meta = {
      description:
        "Metadata for rewind.browser.json (the bundled REWIND dataset). Written by `npm run update-demo-data` together with it " +
        "and fixtures/rewind_golden.json; `npm test` checks that all three agree.",
      dataset: "REWIND interviews",
      file: "rewind.browser.json",
      format: exported.format,
      formatVersion: exported.formatVersion,
      sha256: sha256(text),
      bytes: text.length,
      environmentFingerprint: predicates.environmentFingerprint,
      languageVersion: predicates.languageVersion,
      predicates: predicates.predicates.length,
      facts: predicates.predicates.reduce((n, p) => n + p.count, 0),
      source: provenance,
      beingdb: { repository: "https://github.com/jptmoore/beingdb.git", commit, dirty: isDirty(BEINGDB) },
    };

    // The dataset, its metadata and the goldens are installed together.
    step("Installing data/rewind.browser.json, data/rewind.browser.meta.json and fixtures/rewind_golden.json");
    cpSync(data, DATA);
    cpSync(golden, GOLDEN);
    writeJson(META, meta);
    installed = true;

    step("Validating: WASM build, WASM parity and tutorial lessons (built and prebuilt runtime)");
    wasm(["dune", "build"], { what: "dune build" });
    wasm(["dune", "test", "--force"], { what: "dune test" });
    step("Validating: native Irmin Pack vs exported data parity");
    native(["dune", "test", "--root", "native", "--force"], { env: { ...withoutSwitch(), BEINGDB_PACK: pack }, what: "native parity test" });
    checkBundle();

    rmSync(work, { recursive: true, force: true });
    console.log(`\nBundled REWIND dataset updated: ${meta.predicates} predicates, ${meta.facts} facts, ${(meta.bytes / 1024).toFixed(0)} KB`);
    console.log(`  source:      ${meta.source.repository ?? "(not recorded)"} ${meta.source.commit ?? ""}${meta.source.dirty ? " (uncommitted changes)" : ""}`);
    console.log(`  fingerprint: ${meta.environmentFingerprint}`);
    if (previous && previous.environmentFingerprint !== meta.environmentFingerprint) {
      console.log(`  (was        ${previous.environmentFingerprint})`);
      console.log(
        "\nThe environment fingerprint changed. Artefacts outside this repository that pin it must be\n" +
          "regenerated separately, e.g. the beingdb-webllm eval question sets (eval/questions*.json).",
      );
    } else if (previous && previous.sha256 === meta.sha256) console.log("  (unchanged)");
    console.log("Review with `git diff --stat`, then commit data/ and fixtures/.");
  } catch (e) {
    console.error(`\n${e.message}`);
    if (installed)
      console.error(
        "\nThe dataset, its metadata and the goldens were regenerated together and are consistent, but validation failed.\n" +
          "Fix what failed (for example tutorial lessons whose expected rows changed), or revert with:\n" +
          "  git checkout -- data fixtures",
      );
    else console.error("\nNothing in the repository was changed.");
    console.error(`Work directory kept for inspection: ${work}`);
    process.exit(1);
  }
}

// ---- main -----------------------------------------------------------------------

function check() {
  try {
    checkBundle();
  } catch (e) {
    fail(e.message);
  }
}

const commands = { "update-demo-data": updateDemoData, "update-runtime": updateRuntime, check };
const command = commands[process.argv[2]];
if (!command) fail(`usage: node scripts/maintain.mjs <${Object.keys(commands).join("|")}> [options]`);
await command();

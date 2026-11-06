// Record native BeingDB server responses (Controller + Irmin Pack) as goldens.
// `npm run update-demo-data` runs this against a server it starts. By hand:
//   beingdb serve --pack PACK_DIR --port 8091
//   node fixtures/make_golden.mjs http://localhost:8091 [OUT_FILE]
// OUT_FILE defaults to fixtures/rewind_golden.json.
import { readFile, writeFile } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:8091";
const dir = new URL(".", import.meta.url);
const out = process.argv[3] ?? new URL("rewind_golden.json", dir);
const queries = JSON.parse(await readFile(new URL("rewind_queries.json", dir), "utf8"));

const predicates = await (await fetch(`${base}/predicates?detailed=true`)).json();
const responses = {};
for (const { name, query } of queries) {
  const res = await fetch(`${base}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language: "dsl", action: "execute", query }),
  });
  responses[name] = await res.json();
}
const diagnoseQueries = JSON.parse(await readFile(new URL("rewind_diagnose_queries.json", dir), "utf8"));
const diagnose = {};
for (const { name, query } of diagnoseQueries) {
  const res = await fetch(`${base}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ language: "dsl", action: "diagnose", query }),
  });
  diagnose[name] = await res.json();
}
// validate/explain: the diagnose queries (valid and invalid) plus plan-shaped ones.
const planQueries = JSON.parse(await readFile(new URL("rewind_plan_queries.json", dir), "utf8"));
const validate = {};
const explain = {};
for (const { name, query } of [...diagnoseQueries, ...planQueries]) {
  for (const [action, out] of [["validate", validate], ["explain", explain]]) {
    const res = await fetch(`${base}/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ language: "dsl", action, query }),
    });
    out[name] = await res.json();
  }
}
// GET /resolve and GET /about, including their error responses.
const lookupQueries = JSON.parse(await readFile(new URL("rewind_lookup_queries.json", dir), "utf8"));
const get = async (path, params) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  return (await fetch(`${base}${path}?${search}`)).json();
};
const resolve = {};
for (const { name, text, candidates } of lookupQueries.resolve) resolve[name] = await get("/resolve", { text, candidates });
const about = {};
for (const { name, value, limit } of lookupQueries.about) about[name] = await get("/about", { value, limit });
await writeFile(
  out,
  JSON.stringify({ predicates, queries: responses, diagnose, validate, explain, resolve, about }, null, 1) + "\n",
);
console.log(
  `wrote ${Object.keys(responses).length} query, ${Object.keys(diagnose).length} diagnose, ` +
    `${Object.keys(validate).length} validate/explain and ${Object.keys(resolve).length + Object.keys(about).length} lookup goldens`,
);

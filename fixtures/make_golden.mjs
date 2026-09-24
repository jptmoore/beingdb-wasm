// Record native BeingDB server responses (Controller + Irmin Pack) as goldens.
// Usage: beingdb serve --pack ../beingdb/pack_store --port 8091
//        node fixtures/make_golden.mjs http://localhost:8091
import { readFile, writeFile } from "node:fs/promises";

const base = process.argv[2] ?? "http://localhost:8091";
const dir = new URL(".", import.meta.url);
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
await writeFile(new URL("rewind_golden.json", dir), JSON.stringify({ predicates, queries: responses }, null, 1) + "\n");
console.log(`wrote ${Object.keys(responses).length} query goldens`);

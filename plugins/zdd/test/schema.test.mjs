// templates/config.schema.json against the engine's runtime rules. The schema
// is documentation the adopter's editor enforces; the engine is the truth. A
// shape one accepts and the other refuses is a lie in the docs (CR-082), so the
// fixtures here are checked against BOTH. The validator is a small in-test
// implementation of the draft-07 keywords the schema actually uses — no
// dependency, and a keyword it does not know is a loud failure, not a pass.
// Run: node --test "plugins/zdd/test/*.test.mjs"
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_BIN = resolve(PLUGIN, "..", "..", "packages", "zdd-engine", "bin", "zdd-engine.mjs");
const SCHEMA = JSON.parse(readFileSync(join(PLUGIN, "templates", "config.schema.json"), "utf8"));

const KNOWN = new Set(["$schema", "$id", "$comment", "title", "description", "default", "examples", "deprecated", "type", "properties", "additionalProperties", "required", "items", "minItems", "uniqueItems", "pattern", "enum", "anyOf", "oneOf", "not"]);
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

// Returns the list of violations (empty = valid).
function validate(schema, value, path = "$") {
  if (schema === true) return [];
  if (schema === false) return [`${path}: not allowed`];
  const errs = [];
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`schema keyword ${k} at ${path} is not implemented by this test validator`);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const t = typeOf(value);
    if (!types.includes(t) && !(t === "number" && types.includes("integer") && Number.isInteger(value))) errs.push(`${path}: expected ${types.join("|")}, got ${t}`);
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errs.push(`${path}: not one of ${JSON.stringify(schema.enum)}`);
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: does not match ${schema.pattern}`);
  if (typeOf(value) === "object") {
    for (const r of schema.required ?? []) if (!(r in value)) errs.push(`${path}: missing ${r}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && k in schema.properties) errs.push(...validate(schema.properties[k], v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: additional property ${k}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errs.push(...validate(schema.additionalProperties, v, `${path}.${k}`));
    }
  }
  if (Array.isArray(value)) {
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${path}[${i}]`)));
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errs.push(`${path}: duplicate items`);
  }
  if (schema.anyOf && !schema.anyOf.some((s) => validate(s, value, path).length === 0)) errs.push(`${path}: matches none of anyOf`);
  if (schema.oneOf) {
    const n = schema.oneOf.filter((s) => validate(s, value, path).length === 0).length;
    if (n !== 1) errs.push(`${path}: matches ${n} of oneOf (need exactly 1)`);
  }
  if (schema.not && validate(schema.not, value, path).length === 0) errs.push(`${path}: matches the forbidden shape`);
  return errs;
}

// The engine's verdict on a config: null when derive accepts it, else its message.
function engineRejects(config) {
  const repo = mkdtempSync(join(tmpdir(), "zdd-schema-"));
  try {
    mkdirSync(join(repo, "zdd"));
    writeFileSync(join(repo, "zdd", "config.json"), JSON.stringify(config));
    const r = spawnSync(process.execPath, [ENGINE_BIN, "derive", "--check", `--root=${repo}`], { encoding: "utf8" });
    return r.status === 0 ? null : (r.stderr + r.stdout).trim();
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("the validator itself is honest: a known-bad and a known-good shape", () => {
  assert.deepEqual(validate({ type: "object", required: ["a"], additionalProperties: false, properties: { a: { type: "string" } } }, { a: "x" }), []);
  assert.ok(validate({ type: "object", required: ["a"], additionalProperties: false, properties: { a: { type: "string" } } }, { a: 1, b: 2 }).length === 2);
  assert.throws(() => validate({ minLength: 1 }, "x"), /not implemented/);
});

test("templates/config.example.json validates against templates/config.schema.json (CR-102)", () => {
  const example = JSON.parse(readFileSync(join(PLUGIN, "templates", "config.example.json"), "utf8"));
  assert.deepEqual(validate(SCHEMA, example), []);
});

test("a config with both `extractors` and `adapter` is invalid under the schema, exactly as the engine refuses it (CR-082)", () => {
  const mixed = { extractors: ["generic"], adapter: "nextjs-supabase" };
  assert.notDeepEqual(validate(SCHEMA, mixed), [], "schema must refuse the mixed shape");
  assert.match(engineRejects(mixed) ?? "", /adapter/, "and so does the engine");
  const mixedOptions = { extractors: ["generic"], adapterOptions: {} };
  assert.notDeepEqual(validate(SCHEMA, mixedOptions), []);
  assert.match(engineRejects(mixedOptions) ?? "", /adapter/);
  // Each tier alone is fine for both.
  for (const ok of [{ extractors: ["generic"] }, { adapter: "nextjs-supabase" }, { extractors: ["generic"], extractorOptions: { generic: {} } }]) {
    assert.deepEqual(validate(SCHEMA, ok), [], JSON.stringify(ok));
  }
  assert.equal(engineRejects({ extractors: ["generic"] }), null);
  // Neither tier is invalid for both.
  assert.notDeepEqual(validate(SCHEMA, { name: "x" }), []);
  assert.notEqual(engineRejects({ name: "x" }), null);
});

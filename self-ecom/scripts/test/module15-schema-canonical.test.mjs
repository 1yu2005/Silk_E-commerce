// 作用：只统一PG16 dump/reparse的常量varchar[]→text[]表达式，真实schema变化及SQL字面文本必须保持可辨。
import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalSchemaDefinition, SNAPSHOT_CANONICAL_VERSION } from '../module15-ops-snapshot.mjs';

test('PG16 source/restored CHECK and partial-index casts share one exact logical representation', () => {
  assert.equal(SNAPSHOT_CANONICAL_VERSION, 2);
  for (const [source, restored] of [
    ["CHECK (status::text = ANY (ARRAY['OPEN'::character varying, 'CLOSED'::character varying]::text[]))", "CHECK (status::text = ANY (ARRAY['OPEN'::character varying::text, 'CLOSED'::character varying::text]))"],
    ["CREATE UNIQUE INDEX i ON public.t USING btree (id) WHERE ((status)::text <> ALL ((ARRAY['OPEN'::character varying, 'CLOSED'::character varying])::text[]))", "CREATE UNIQUE INDEX i ON public.t USING btree (id) WHERE ((status)::text <> ALL (ARRAY[('OPEN'::character varying)::text, ('CLOSED'::character varying)::text]))"],
    ["CHECK (x = ANY (ARRAY['a,b'::character varying, 'x''y'::character varying]::text[]))", "CHECK (x = ANY (ARRAY['a,b'::character varying::text, 'x''y'::character varying::text]))"],
  ]) {
    assert.notEqual(source, restored);
    const result = canonicalSchemaDefinition(source);
    assert.equal(result, canonicalSchemaDefinition(restored)); assert.equal(canonicalSchemaDefinition(result), result);
  }
});

test('changed states, operators, columns, names and validation clauses remain unequal', () => {
  const original = "CHECK (status::text = ANY (ARRAY['OPEN'::character varying, 'CLOSED'::character varying]::text[]))";
  for (const changed of [original.replace("'CLOSED'", "'CANCELLED'"), original.replace('= ANY', '<> ALL'), original.replace('status', 'other_status'), original.replace('text[]', 'varchar[]'), original + ' NOT VALID']) {
    assert.notEqual(canonicalSchemaDefinition(original), canonicalSchemaDefinition(changed));
  }
});

test('nonconstant, bounded varchar, nontext or collated arrays are kept strict', () => {
  for (const definition of [
    "CHECK (x = ANY (ARRAY[y::character varying]::text[]))",
    "CHECK (x = ANY (ARRAY['long'::character varying(2)]::text[]))",
    "CHECK (x = ANY (ARRAY['OPEN'::character varying]::integer[]))",
    "CHECK (x = ANY (ARRAY['OPEN'::character varying COLLATE \"C\"]::text[]))",
    "CHECK (x = ANY (ARRAY[NULL::character varying]::text[]))",
    "CHECK (x = ANY (ARRAY[E'escaped'::character varying]::text[]))",
  ]) assert.equal(canonicalSchemaDefinition(definition), definition);
});

test('quoted SQL, quoted identifiers, function calls, comments and dollar bodies cannot be reinterpreted as an array cast', () => {
  for (const definition of [
    "CHECK (description <> 'ARRAY[''OPEN''::character varying]::text[]')",
    'CREATE INDEX "ARRAY[\'OPEN\'::character varying]::text[]" ON t (id)',
    "CHECK (x = my_function(ARRAY['OPEN'::character varying])::text[])",
    "CHECK (x = my_function (ARRAY['OPEN'::character varying])::text[])",
    "CHECK (x = MYARRAY['OPEN'::character varying]::text[])",
    "CHECK (x = ANY (ARRAY['OPEN'::character varying]::text[])) -- retain opaque SQL",
    "CHECK (x = ANY (ARRAY['OPEN'::character varying]::text[])) /* retain opaque SQL */",
    "CHECK (x <> $$ARRAY['OPEN'::character varying]::text[]$$)",
  ]) assert.equal(canonicalSchemaDefinition(definition), definition);
});

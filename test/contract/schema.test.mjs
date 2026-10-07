// Unit tests for the JSON-schema subset the HubSpot contract tests use. These run without
// HubSpot's specs, so a broken validator cannot quietly turn the contract tests green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './schema.mjs';

const spec = {
  components: {
    schemas: {
      Page: { type: 'object', required: ['results'], properties: { results: { type: 'array', items: { $ref: '#/components/schemas/Item' } }, paging: { $ref: '#/components/schemas/Paging' } } },
      Item: { type: 'object', required: ['id', 'createdAt'], properties: { id: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, n: { type: 'integer' }, ok: { type: 'boolean' }, kind: { type: 'string', enum: ['A', 'B'] }, props: { type: 'object', additionalProperties: { type: 'string' } } } },
      Paging: { type: 'object', properties: { next: { type: 'object', required: ['after'], properties: { after: { type: 'string' } } } } },
    },
  },
};
const page = (item) => ({ results: [{ id: '1', createdAt: '2026-10-05T07:00:00.000Z', ...item }] });
const check = (value) => validate({ $ref: '#/components/schemas/Page' }, value, spec);

test('a value that matches the schema has no errors', () => {
  assert.deepEqual(check({ ...page({ n: 3, ok: true, kind: 'A', props: { a: 'x' } }), paging: { next: { after: '9' } } }), []);
});

test('a missing required field is reported with its path', () => {
  assert.deepEqual(check({ results: [{ id: '1' }] }), ['$.results[0].createdAt is required']);
});

test('wrong types, enum values and date-times are reported', () => {
  assert.deepEqual(check(page({ id: 1 })), ['$.results[0].id should be string, got number']);
  assert.deepEqual(check(page({ n: 1.5 })), ['$.results[0].n should be integer, got number']);
  assert.deepEqual(check(page({ ok: 'true' })), ['$.results[0].ok should be boolean, got string']);
  assert.deepEqual(check(page({ kind: 'C' })), ['$.results[0].kind should be one of A, B, got "C"']);
  assert.deepEqual(check(page({ createdAt: 'yesterday' })), ['$.results[0].createdAt should be a date-time, got "yesterday"']);
  assert.deepEqual(check({ results: {} }), ['$.results should be array, got object']);
});

test('additionalProperties schemas apply to every extra key', () => {
  assert.deepEqual(check(page({ props: { a: 'x', b: 2 } })), ['$.results[0].props.b should be string, got number']);
});

test('null is rejected unless the caller allows it for that path', () => {
  assert.deepEqual(check(page({ props: { a: null } })), ['$.results[0].props.a should be string, got null']);
  const allow = (path) => /^\$\.results\[\d+\]\.props\.[^.]+$/.test(path);
  assert.deepEqual(validate({ $ref: '#/components/schemas/Page' }, page({ props: { a: null } }), spec, { allowNull: allow }), []);
});

test('nested $ref chains resolve (paging.next.after)', () => {
  assert.deepEqual(check({ ...page({}), paging: { next: {} } }), ['$.paging.next.after is required']);
});

test('a keyword the validator does not implement throws instead of passing unchecked', () => {
  for (const keyword of ['oneOf', 'anyOf', 'allOf', 'not', 'nullable', 'pattern', 'maxLength', 'minimum']) {
    const schema = { type: 'object', properties: { a: { type: 'string', [keyword]: keyword === 'not' ? {} : [] } } };
    assert.throws(() => validate(schema, { a: 'x' }, {}), new RegExp(`unsupported schema keyword "${keyword}" at \\$\\.a`), keyword);
  }
});

test('an unsupported keyword is caught even when the value would never reach it', () => {
  assert.throws(() => validate({ type: 'object', oneOf: [{ type: 'string' }] }, 7, {}), /unsupported schema keyword "oneOf" at \$/);
});

test('annotation keywords are allowed and change nothing', () => {
  const schema = { type: 'string', description: 'd', example: 'e', title: 't', default: 'x', readOnly: true, deprecated: false };
  assert.deepEqual(validate(schema, 'ok', {}), []);
});

test('additionalProperties: false reports every key the schema does not list', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };
  assert.deepEqual(validate(schema, { a: 'x' }, {}), []);
  assert.deepEqual(validate(schema, { a: 'x', b: 1, c: 2 }, {}), ['$.b is not allowed (additionalProperties is false)', '$.c is not allowed (additionalProperties is false)']);
});

test('additionalProperties: true allows any extra key', () => {
  assert.deepEqual(validate({ type: 'object', properties: {}, additionalProperties: true }, { b: 1 }, {}), []);
});

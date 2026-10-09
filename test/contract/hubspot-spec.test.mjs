// Contract tests: the recorded HubSpot responses in test/fixtures/hubspot and the requests the
// client sends, checked against HubSpot's published OpenAPI specs. The specs are not
// redistributable, so they are read from HUBSPOT_SPEC_DIR and these tests skip when it is unset.
// Fetch them with: node scripts/fetch-hubspot-specs.mjs /tmp/hubspot-specs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SPEC_SHA, SPEC_FILES, checkSpecDir } from '../../scripts/fetch-hubspot-specs.mjs';
import { validate } from './schema.mjs';
import { createHubSpotClient, DEAL_PROPERTIES } from '../../src/hubspot.mjs';
import { fakeFetch, happyRoutes } from '../helpers/fake-hubspot.mjs';

const DIR = process.env.HUBSPOT_SPEC_DIR;
const skip = DIR ? false : 'HUBSPOT_SPEC_DIR is not set (fetch the specs with: node scripts/fetch-hubspot-specs.mjs DIR)';

function loadSpec(name) {
  const provenance = checkSpecDir(DIR);
  assert.equal(provenance, null, provenance ?? '');
  const file = join(DIR, SPEC_FILES[name].saveAs);
  assert.ok(existsSync(file), `${file} is missing. Run: node scripts/fetch-hubspot-specs.mjs ${DIR}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('the spec files are pinned to one commit of HubSpot-public-api-spec-collection', () => {
  assert.match(SPEC_SHA, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(SPEC_FILES).sort(), ['deals', 'owners', 'pipelines']);
  for (const f of Object.values(SPEC_FILES)) assert.match(f.path, /^PublicApiSpecs\/CRM\/.+\/v3\/[^/]+\.json$/);
});

test('the spec folder was fetched at the pinned commit (its marker matches SPEC_SHA)', { skip }, () => {
  const provenance = checkSpecDir(DIR);
  assert.equal(provenance, null, provenance ?? '');
});

test('each spec file is the v3 spec for the endpoint the client calls', { skip }, () => {
  assert.ok(loadSpec('deals').paths['/crm/v3/objects/0-3']?.get, 'deals spec lists GET /crm/v3/objects/0-3');
  assert.ok(loadSpec('pipelines').paths['/crm/v3/pipelines/{objectType}']?.get, 'pipelines spec lists GET /crm/v3/pipelines/{objectType}');
  assert.ok(loadSpec('owners').paths['/crm/v3/owners']?.get, 'owners spec lists GET /crm/v3/owners');
});

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/hubspot/${name}`, import.meta.url), 'utf8'));
const ok200 = (spec, path) => spec.paths[path].get.responses['200'].content['application/json'].schema;

// The spec types every deal property value as a string. HubSpot returns null for a requested
// property that has no value on the deal, and the client must cope with that, so null is
// allowed for property values only, nowhere else in the response.
const nullPropertyValue = (path) => /^\$\.results\[\d+\]\.properties\.[^.[\]]+$/.test(path);

test('recorded deal pages match the GET /crm/v3/objects/0-3 response schema', { skip }, () => {
  const spec = loadSpec('deals');
  for (const name of ['deals-page1.json', 'deals-page2.json', 'deals-real-shape.json']) {
    assert.deepEqual(validate(ok200(spec, '/crm/v3/objects/0-3'), fixture(name), spec, { allowNull: nullPropertyValue }), [], name);
  }
});

test('recorded pipelines match the GET /crm/v3/pipelines/{objectType} response schema', { skip }, () => {
  const spec = loadSpec('pipelines');
  assert.deepEqual(validate(ok200(spec, '/crm/v3/pipelines/{objectType}'), fixture('pipelines.json'), spec), []);
});

test('recorded owners (active and archived) match the GET /crm/v3/owners response schema', { skip }, () => {
  const spec = loadSpec('owners');
  for (const name of ['owners.json', 'owners-archived.json']) {
    assert.deepEqual(validate(ok200(spec, '/crm/v3/owners'), fixture(name), spec), [], name);
  }
});

const errorSchema = (spec) => spec.components.responses.Error.content['*/*'].schema;

test('recorded HubSpot error bodies (401, 403, 429) match the spec Error schema of every endpoint the client calls', { skip }, () => {
  for (const status of [401, 403, 429]) {
    const body = fixture(`error-${status}.json`);
    for (const name of ['deals', 'pipelines', 'owners']) {
      const spec = loadSpec(name);
      for (const [path] of [['/crm/v3/objects/0-3'], ['/crm/v3/pipelines/{objectType}'], ['/crm/v3/owners']].filter(([p]) => spec.paths[p])) {
        assert.equal(spec.paths[path].get.responses.default.$ref, '#/components/responses/Error', `${name} ${path} errors use the shared Error response`);
      }
      assert.deepEqual(validate(errorSchema(spec), body, spec), [], `error-${status}.json against ${name}`);
    }
  }
});

// The client calls /crm/v3/objects/deals. The v3 deals spec lists the same endpoint under the
// deals object type id, /crm/v3/objects/0-3, and its own description names `deals` as the
// object type. So `deals` is mapped to `0-3` here, and the next test holds that mapping to the
// spec's own words.
const OPERATIONS = [
  { spec: 'deals', client: '/crm/v3/objects/deals', template: '/crm/v3/objects/0-3' },
  { spec: 'pipelines', client: '/crm/v3/pipelines/deals', template: '/crm/v3/pipelines/{objectType}', pathParams: { objectType: 'deals' } },
  { spec: 'owners', client: '/crm/v3/owners', template: '/crm/v3/owners' },
];

test('the deals spec names `deals` as the object type behind /crm/v3/objects/0-3', { skip }, () => {
  assert.match(loadSpec('deals').info.description, /\|\s*`deals`\s*\|\s*`dealname`, `amount`, `closedate`, `pipeline`, `dealstage`\s*\|/);
});

function conforms(schema, value) {
  if (schema.type === 'integer') return /^\d+$/.test(value);
  if (schema.type === 'boolean') return value === 'true' || value === 'false';
  if (schema.type === 'array') return value.split(',').every((v) => v.length > 0);
  return schema.type === 'string';
}

test('every request the client sends uses a path, method and query parameters the spec defines', { skip }, async () => {
  const fetch = fakeFetch(happyRoutes());
  const c = createHubSpotClient({ token: ['pat', 'na1', '00000000-0000-0000-0000-000000000000'].join('-'), fetch, sleep: async () => {} });
  await c.listDeals();
  await c.listPipelines();
  await c.listOwners();
  const seen = new Set();
  for (const call of fetch.calls) {
    const url = new URL(call.url);
    assert.equal(url.origin, 'https://api.hubapi.com');
    const op = OPERATIONS.find((o) => o.client === url.pathname);
    assert.ok(op, `${url.pathname} is not an endpoint this test knows`);
    const spec = loadSpec(op.spec);
    assert.equal(spec.servers[0].url, url.origin, `${op.spec} spec server`);
    const operation = spec.paths[op.template]?.[call.method.toLowerCase()];
    assert.ok(operation, `${call.method} ${op.template} is in the ${op.spec} spec`);
    for (const [name, value] of Object.entries(op.pathParams ?? {})) {
      assert.ok(operation.parameters.some((p) => p.in === 'path' && p.name === name), `${name} is a path parameter`);
      assert.equal(op.template.replace(`{${name}}`, value), url.pathname);
    }
    for (const [name, value] of url.searchParams) {
      const param = operation.parameters.find((p) => p.in === 'query' && p.name === name);
      assert.ok(param, `${call.method} ${op.template} has no query parameter "${name}"`);
      assert.ok(conforms(param.schema, value), `${name}=${value} does not fit the spec type ${param.schema.type}`);
    }
    for (const p of operation.parameters.filter((x) => x.required && x.in === 'query')) {
      assert.ok(url.searchParams.has(p.name), `required query parameter ${p.name} is sent`);
    }
    seen.add(op.client);
  }
  assert.equal(seen.size, OPERATIONS.length, 'all three endpoints were called');
});

test('the deals spec does not enumerate deal property names, so only the default ones can be checked', { skip }, () => {
  const spec = loadSpec('deals');
  const props = spec.components.schemas.SimplePublicObjectWithAssociations.properties.properties;
  // If HubSpot ever enumerates deal properties here, replace this with a check of DEAL_PROPERTIES.
  assert.equal(props.properties, undefined, 'deal properties are now enumerated in the spec');
  assert.equal(props.additionalProperties.type, 'string');
  // The properties the spec names as the deals defaults are all requested explicitly.
  for (const name of ['dealname', 'amount', 'closedate', 'pipeline', 'dealstage']) assert.ok(DEAL_PROPERTIES.includes(name), name);
});

test('paging is paging.next.after in the deals and owners specs, and the client sends that cursor back as `after`', { skip }, async () => {
  for (const name of ['deals', 'owners']) {
    const { schemas } = loadSpec(name).components;
    assert.equal(schemas.ForwardPaging.properties.next.$ref, '#/components/schemas/NextPage', name);
    assert.deepEqual(schemas.NextPage.required, ['after'], name);
    assert.equal(schemas.NextPage.properties.after.type, 'string', name);
  }
  const fetch = fakeFetch(happyRoutes());
  await createHubSpotClient({ token: ['pat', 'na1', '00000000-0000-0000-0000-000000000000'].join('-'), fetch, sleep: async () => {} }).listDeals();
  const cursors = fetch.calls.map((c) => new URL(c.url).searchParams.get('after'));
  assert.deepEqual(cursors, [null, fixture('deals-page1.json').paging.next.after]);
});

// The stale check needs each deal's creation date. `createdate` is not one of the five default
// deal properties the spec names, so the client requests it by name; the spec does document a
// top-level `createdAt` on every deal record as a required date-time, which the snapshot uses
// when `createdate` is missing.
test('the creation date: createdate is requested by name, and createdAt is a required, documented date-time on every deal', { skip }, () => {
  const spec = loadSpec('deals');
  assert.doesNotMatch(spec.info.description, /\|\s*`deals`\s*\|[^\n]*`createdate`/, 'createdate is now a documented default; the explicit request can be reconsidered');
  assert.ok(DEAL_PROPERTIES.includes('createdate'), 'createdate is requested by name');
  const deal = spec.components.schemas.SimplePublicObjectWithAssociations;
  assert.ok(deal.required.includes('createdAt'));
  assert.equal(deal.properties.createdAt.type, 'string');
  assert.equal(deal.properties.createdAt.format, 'date-time');
  assert.match(deal.properties.createdAt.description, /created/i);
});

// The spec documents `probability` but not `isClosed`, which the tool reads to tell open from
// closed stages. That is why src/snapshot.mjs falls back to probability alone (1 won, 0 lost,
// else open) when a stage has no isClosed; test/snapshot.test.mjs covers the fallback.
test('stage metadata is a string map in the spec, and the recorded probability values are strings from 0.0 to 1.0', { skip }, () => {
  const stage = loadSpec('pipelines').components.schemas.PipelineStage;
  assert.ok(stage.required.includes('metadata'));
  assert.equal(stage.properties.metadata.additionalProperties.type, 'string');
  assert.match(stage.properties.metadata.description, /For `deals` pipelines, the `probability` field is required/);
  for (const p of fixture('pipelines.json').results) {
    for (const s of p.stages) {
      assert.equal(typeof s.metadata.probability, 'string', s.id);
      const n = Number(s.metadata.probability);
      assert.ok(n >= 0 && n <= 1, `${s.id} probability ${s.metadata.probability}`);
      assert.match(s.metadata.isClosed, /^(true|false)$/, `${s.id} isClosed is the string "true" or "false"`);
    }
  }
});

// Stateless mode's deal and pipeline requests. The currency endpoint has no spec in this
// collection's pinned files, so it is covered by its live check (spike/FINDINGS.md) only.
import { statelessRoutes } from '../helpers/fake-hubspot.mjs';

test('the stateless read path sends paths, methods, query parameters and a batch body the spec defines', { skip }, async () => {
  const fetch = fakeFetch(statelessRoutes());
  const c = createHubSpotClient({ token: ['pat', 'na1', '00000000-0000-0000-0000-000000000000'].join('-'), fetch, sleep: async () => {} });
  await c.listDealsWithHistory();
  await c.listArchivedDeals();
  await c.readArchivedWithHistory(['7004']);
  await c.pipelineAudit('default');
  const deals = loadSpec('deals');
  const pipelines = loadSpec('pipelines');
  const ops = {
    '/crm/v3/objects/deals': [deals, '/crm/v3/objects/0-3'],
    '/crm/v3/objects/deals/batch/read': [deals, '/crm/v3/objects/0-3/batch/read'],
    '/crm/v3/pipelines/deals/default/audit': [pipelines, '/crm/v3/pipelines/{objectType}/{pipelineId}/audit'],
  };
  for (const call of fetch.calls) {
    const url = new URL(call.url);
    const [spec, template] = ops[url.pathname] ?? [];
    assert.ok(spec, `${url.pathname} is not an endpoint this test knows`);
    const operation = spec.paths[template]?.[call.method.toLowerCase()];
    assert.ok(operation, `${call.method} ${template} is in the spec`);
    for (const [name, value] of url.searchParams) {
      const param = operation.parameters.find((p) => p.in === 'query' && p.name === name);
      assert.ok(param, `${call.method} ${template} has no query parameter "${name}"`);
      assert.ok(conforms(param.schema, value), `${name}=${value} does not fit the spec type ${param.schema.type}`);
    }
    if (call.body) {
      const schema = operation.requestBody.content['application/json'].schema;
      assert.deepEqual(validate(schema, call.body, spec), [], `${template} request body`);
    }
  }
  assert.equal(fetch.calls.length, 5, "two history pages, the archived list, one batch read, one audit");
});

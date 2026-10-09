import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNKNOWN_FIELDS } from '../src/history.mjs';
import { compareStateless } from '../src/stateless.mjs';
import { renderBrief, toSlack } from '../src/render.mjs';

const d = (id, amount, status = 'open') => ({
  id, name: `Deal ${id}`, owner: 'o', pipeline_id: 'p', pipeline: 'P', stage_id: status === 'open' ? 's' : `closed${status}`, stage: 'S',
  stage_order: 0, status, amount, close_date: '2026-12-01', next_step: 'x', last_activity: '2026-10-09', created: '2026-10-01', url: null,
});
const cents = (n) => Math.round(n * 100);

test('compareStateless moves deals that could not be rebuilt out of New into their own bucket, and the bridge balances to the live open total', () => {
  const previous = { date: '2026-10-02', pipelines: [], deals: [d('A', 100)] };
  const current = { date: '2026-10-09', pipelines: [], deals: [d('A', 150), d('U', 70), d('W', 30, 'won')] };
  const unknown = [{ id: 'U', reason: 'merged', fields: ['amount'] }, { id: 'W', reason: 'capped', fields: ['stage_id'] }, { id: 'X', reason: 'capped', fields: ['amount'] }];
  const r = compareStateless(previous, current, unknown, '2026-10-09');
  assert.deepEqual(r.newDeals.map((x) => x.id), []);
  assert.deepEqual(r.won.map((x) => x.id), []);
  assert.equal(r.bridge.new.count, 0);
  assert.equal(r.bridge.won.cents, 0);
  assert.deepEqual(r.bridge.couldNotRebuild, { cents: cents(70), count: 1 });
  assert.deepEqual(r.couldNotRebuild.map((u) => [u.id, u.reason, u.deal?.id ?? null]), [['U', 'merged', 'U'], ['W', 'capped', 'W'], ['X', 'capped', null]]);
  const b = r.bridge;
  const walked = b.start + b.new.cents + b.reopened.cents + b.increases.cents - b.decreases.cents - b.won.cents - b.lost.cents - b.removed.cents + b.couldNotRebuild.cents;
  assert.equal(walked, b.end);
  assert.equal(b.end, cents(220));
});

// A could-not-rebuild entry's atT is its snapshot row at T, as buildStateless makes it:
// built by buildSnapshot from its properties at T with the stage layout at T.
const atT = (id, amount, status = 'open') => d(id, amount, status);
const bridgeWalk = (b) => b.start + b.new.cents + b.reopened.cents + b.increases.cents - b.decreases.cents - b.won.cents - b.lost.cents - b.removed.cents + b.couldNotRebuild.cents;

function statelessCase() {
  const previous = { date: '2026-10-02', pipelines: [], deals: [d('A', 100)] };
  const current = { date: '2026-10-09', pipelines: [], deals: [d('A', 100), d('H', 70), d('M', 60), d('C', 40)] };
  const unknown = [
    { id: 'H', reason: 'capped', fields: ['stage_id', 'status', 'stage_order'], atT: atT('H', 50) },
    { id: 'M', reason: 'merged', fields: UNKNOWN_FIELDS, sources: ['S1', 'S2'] },
    { id: 'C', reason: 'capped', fields: ['close_date'], atT: atT('C', 30) },
  ];
  return compareStateless(previous, current, unknown, '2026-10-09');
}

test('compareStateless: only a deal known to be open at T with a known amount adds to the start, and the bridge balances', () => {
  const r = statelessCase();
  const b = r.bridge;
  assert.equal(b.start, cents(130));
  assert.deepEqual(r.startBreakdown, { rebuilt: cents(100), known: cents(30), knownCount: 1, mergedSources: 2, unknownCount: 1 });
  assert.equal(r.previousOpenTotal, 130);
  assert.deepEqual(b.couldNotRebuild, { cents: cents(130), count: 2 });
  assert.deepEqual(b.increases, { cents: cents(10), count: 1 });
  assert.equal(bridgeWalk(b), b.end);
  assert.equal(b.end, cents(270));
});

test('compareStateless: a capped-stage deal never adds its amount at T to the open start (status at T unknown)', () => {
  const previous = { date: '2026-10-02', pipelines: [], deals: [] };
  const current = { date: '2026-10-09', pipelines: [], deals: [d('H', 70)] };
  const r = compareStateless(previous, current, [{ id: 'H', reason: 'capped', fields: ['stage_id', 'status', 'stage_order'], atT: atT('H', 50) }], '2026-10-09');
  assert.equal(r.bridge.start, 0);
  assert.equal(r.startBreakdown.unknownCount, 1);
  assert.equal(bridgeWalk(r.bridge), r.bridge.end);
});

test('compareStateless: a deal known to be closed at T adds nothing to the open start and nothing to the caveat', () => {
  const previous = { date: '2026-10-02', pipelines: [], deals: [] };
  const current = { date: '2026-10-09', pipelines: [], deals: [d('W', 90, 'won')] };
  const r = compareStateless(previous, current, [{ id: 'W', reason: 'capped', fields: ['close_date'], atT: atT('W', 90, 'won') }], '2026-10-09');
  assert.equal(r.bridge.start, 0);
  assert.deepEqual(r.startBreakdown, { rebuilt: 0, known: 0, knownCount: 0, mergedSources: 0, unknownCount: 0 });
  assert.deepEqual(r.won, []);
  assert.equal(r.bridge.won.cents, 0);
  assert.equal(r.bridge.couldNotRebuild.cents, 0);
  assert.equal(bridgeWalk(r.bridge), r.bridge.end);
});

test('compareStateless: a deal known open at T and gone today leaves through Removed from HubSpot, never a negative could-not-rebuild line', () => {
  const previous = { date: '2026-10-02', pipelines: [], deals: [d('A', 100)] };
  const current = { date: '2026-10-09', pipelines: [], deals: [d('A', 100)] };
  const r = compareStateless(previous, current, [{ id: 'G', reason: 'capped', fields: ['close_date'], atT: atT('G', 70) }], '2026-10-09');
  assert.deepEqual(r.bridge.removed, { cents: cents(70), count: 1 });
  assert.deepEqual(r.removed.map((x) => x.id), ['G']);
  assert.deepEqual(r.bridge.couldNotRebuild, { cents: 0, count: 0 });
  assert.equal(bridgeWalk(r.bridge), r.bridge.end);
});

test('compareStateless: a deal known open at T and won today is Won, and its unknown close date claims no slip', () => {
  const previous = { date: '2026-10-02', pipelines: [], deals: [] };
  const current = { date: '2026-10-09', pipelines: [], deals: [d('G', 80, 'won')] };
  const r = compareStateless(previous, current, [{ id: 'G', reason: 'capped', fields: ['close_date'], atT: atT('G', 70) }], '2026-10-09');
  assert.deepEqual(r.won.map((x) => x.id), ['G']);
  assert.deepEqual(r.bridge.increases, { cents: cents(10), count: 1 });
  assert.deepEqual(r.bridge.couldNotRebuild, { cents: 0, count: 0 });
  assert.equal(bridgeWalk(r.bridge), r.bridge.end);
});

// The read path and the rebuild, against a stand-in client (no network).
import { statelessRead, buildStateless, StatelessRefusal } from '../src/stateless.mjs';
import { HubSpotError } from '../src/hubspot.mjs';

const T0 = new Date('2026-10-02T09:00:00Z');
const NOW0 = new Date('2026-10-09T09:00:00Z');
const PIPELINES = [{ id: 'default', label: 'Sales', stages: [
  { id: 'a', label: 'Discovery', displayOrder: 0, metadata: { isClosed: 'false', probability: '0.2' } },
  { id: 'b', label: 'Proposal', displayOrder: 1, metadata: { isClosed: 'false', probability: '0.6' } },
  { id: 'won', label: 'Won', displayOrder: 2, metadata: { isClosed: 'true', probability: '1.0' } },
] }];
const OWNERS = [{ id: '9', firstName: 'Dana', lastName: 'Reyes' }];

function fakeClient({ rates = [], live = [], archivedList = [], archived = [], audits = {}, ratesError } = {}) {
  const calls = [];
  return {
    calls,
    listExchangeRates: async () => { calls.push('rates'); if (ratesError) throw ratesError; return rates; },
    listDealsWithHistory: async () => { calls.push('live'); return live; },
    listArchivedDeals: async () => { calls.push('archived-list'); return archivedList; },
    readArchivedWithHistory: async (ids) => { calls.push(`batch:${ids.length}`); return archived.filter((r) => ids.includes(r.id)); },
    listPipelines: async () => { calls.push('pipelines'); return PIPELINES; },
    pipelineAudit: async (id) => { calls.push(`audit:${id}`); return audits[id] ?? []; },
    listOwners: async () => { calls.push('owners'); return OWNERS; },
  };
}

test('statelessRead refuses a portal with exchange rates (more than one currency) before reading any deal', async () => {
  const c = fakeClient({ rates: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', conversionRate: 1.1 }] });
  await assert.rejects(statelessRead(c, T0), (err) => {
    assert.ok(err instanceof StatelessRefusal);
    assert.match(err.message, /more than one currency/);
    assert.match(err.message, /stored snapshots/);
    return true;
  });
  assert.deepEqual(c.calls, ['rates']);
});

test('statelessRead refuses when the token lacks settings.currencies.read, naming the scope', async () => {
  const c = fakeClient({ ratesError: new HubSpotError('HubSpot refused the currency settings (403). Stateless mode needs the settings.currencies.read scope', 403) });
  await assert.rejects(statelessRead(c, T0), (err) => err instanceof StatelessRefusal && /settings\.currencies\.read/.test(err.message));
  assert.deepEqual(c.calls, ['rates']);
});

test('statelessRead batch reads only the deals archived after T, 50 per call, then pipelines, audits and owners', async () => {
  const archivedList = Array.from({ length: 130 }, (_, i) => ({ id: String(1000 + i), archivedAt: i < 10 ? '2026-10-01T00:00:00Z' : '2026-10-05T00:00:00Z' }));
  const c = fakeClient({ archivedList });
  const read = await statelessRead(c, T0);
  assert.deepEqual(c.calls, ['rates', 'live', 'archived-list', 'batch:50', 'batch:50', 'batch:20', 'pipelines', 'audit:default', 'owners']);
  assert.equal(read.archivedListed, 130);
  assert.ok(read.audits instanceof Map);
});

const v = (value, timestamp, extra = {}) => ({ value, timestamp, ...extra });
const BEFORE = '2026-09-20T00:00:00Z';
function rec(id, { history = {}, properties = {}, archivedAt } = {}) {
  const h = {
    createdate: [v(BEFORE, BEFORE)], dealname: [v(`Deal ${id}`, BEFORE)], pipeline: [v('default', BEFORE)],
    dealstage: [v('a', BEFORE)], amount: [v('100', BEFORE)], closedate: [v('2026-11-01T00:00:00Z', BEFORE)],
    hubspot_owner_id: [v('9', BEFORE)], hs_next_step: [v('call', BEFORE)], ...history,
  };
  const now = Object.fromEntries(Object.entries(h).map(([k, vs]) => [k, vs[0]?.value ?? null]));
  return { id, createdAt: BEFORE, url: `https://app.hubspot.com/r/${id}`, archived: Boolean(archivedAt), archivedAt, properties: { ...now, ...properties }, propertiesWithHistory: h };
}
const after = (s) => new Date(T0.getTime() + s * 1000).toISOString();

test('buildStateless rebuilds the previous snapshot at T, builds today from the live listing, and counts pushes', () => {
  const live = [
    rec('1', { history: { dealstage: [v('b', after(10)), v('a', BEFORE)] } }),
    rec('2', { history: { createdate: [v(after(20), after(20))], dealstage: [v('a', after(20))] } }),
    rec('4', { history: { closedate: [v('2026-12-15T00:00:00Z', after(30)), v('2026-11-20T00:00:00Z', after(20)), v('2026-11-01T00:00:00Z', BEFORE)] } }),
    rec('5', { history: { closedate: Array.from({ length: 20 }, (_, i) => v(`2026-12-${String(i + 1).padStart(2, '0')}T00:00:00Z`, after(100 - i))) } }),
  ];
  const archived = [rec('3', { archivedAt: after(40), history: { amount: [v('50', BEFORE)] } })];
  const out = buildStateless({ live, archived, pipelines: PIPELINES, audits: new Map(), owners: OWNERS, T: T0, now: NOW0, previousDate: '2026-10-02', date: '2026-10-09' });
  assert.deepEqual(out.previous.deals.map((x) => x.id).sort(), ['1', '3', '4']);
  assert.equal(out.previous.date, '2026-10-02');
  assert.equal(out.previous.deals.find((x) => x.id === '1').stage, 'Discovery');
  assert.equal(out.previous.deals.find((x) => x.id === '1').owner, 'Dana Reyes');
  assert.deepEqual(out.current.deals.map((x) => x.id).sort(), ['1', '2', '4', '5']);
  assert.equal(out.current.date, '2026-10-09');
  assert.equal(out.current.deals.find((x) => x.id === '1').stage, 'Proposal');
  assert.deepEqual(out.unknown.map((u) => [u.id, u.reason, u.fields]), [['5', 'capped', ['close_date']]]);
  assert.equal(out.unknown[0].atT.status, 'open');
  assert.equal(out.unknown[0].atT.stage, 'Discovery');
  assert.equal(out.pushes.get('4'), 2);
  assert.equal(out.pushes.has('1'), false);
});

test('buildStateless uses the stage layout at T from the pipeline audit', () => {
  const raw = JSON.stringify({ pipelineId: 'default', label: 'Sales then', stages: [
    { stageId: 'a', label: 'Intro', displayOrder: 0, metadata: { isClosed: 'false', probability: '0.2' } },
  ] });
  const audits = new Map([['default', [{ action: 'UPDATE', timestamp: after(5), rawObject: '{"pipelineId":"default","label":"Sales","stages":[]}' }, { action: 'CREATE', timestamp: BEFORE, rawObject: raw }]]]);
  const out = buildStateless({ live: [rec('1')], archived: [], pipelines: PIPELINES, audits, owners: OWNERS, T: T0, now: NOW0, previousDate: '2026-10-02', date: '2026-10-09' });
  assert.equal(out.previous.deals[0].stage, 'Intro');
  assert.equal(out.previous.pipelines[0].label, 'Sales then');
  assert.equal(out.current.deals[0].stage, 'Discovery');
});

// The brief a stateless result prints.
test('renderBrief: a stateless brief says what it compared with', () => {
  assert.match(renderBrief(statelessCase()), /^Compared with HubSpot as of Oct 2, rebuilt from property history\.$/m);
});

test('renderBrief: the start line splits rebuilt from partly rebuilt, and the bridge prints the could-not-rebuild line', () => {
  const text = renderBrief(statelessCase());
  assert.match(text, /^- Oct 2 open pipeline: \$130 \(\$100 rebuilt \+ \$30 from 1 deal only partly rebuilt\)$/m);
  assert.match(text, /- Could not rebuild: \+\$130 \(2\)\n- Oct 9 open pipeline: \$270/);
});

test('renderBrief: the headline says what the start leaves out, counting a merge as its sources', () => {
  assert.match(renderBrief(statelessCase()), /Open pipeline \$270 across 4 deals, up \$140 on last week \(the Oct 2 total leaves out 2 deals merged since then and 1 deal whose state then could not be rebuilt\)\./);
  const previous = { date: '2026-10-02', pipelines: [], deals: [d('A', 100)] };
  const current = { date: '2026-10-09', pipelines: [], deals: [d('A', 100), d('M', 11)] };
  const r = compareStateless(previous, current, [{ id: 'M', reason: 'merged', fields: UNKNOWN_FIELDS, sources: ['S1', 'S2'] }], '2026-10-09');
  assert.match(renderBrief(r), /\(the Oct 2 total leaves out 2 deals merged since then\)\./);
});

test('renderBrief: the Could not rebuild section names merge sources and says what is unknown', () => {
  const text = renderBrief(statelessCase());
  const section = text.slice(text.indexOf('**Could not rebuild as of Oct 2** (3)'));
  assert.ok(section.length > 0);
  assert.match(section, /- Deal M, \$60, o: merged since Oct 2 from records S1 and S2, so what they held then is unknown/);
  assert.match(section, /- Deal H, \$70, o: more than 20 changes to its stage since Oct 2, so its state then is unknown/);
  assert.match(section, /- Deal C, \$40, o: more than 20 changes to its close date since Oct 2; open then at \$30/);
});

test('renderBrief: a deal known open at T and gone today shows in Removed from HubSpot and its bridge line, never as a negative could-not-rebuild line', () => {
  const previous = { date: '2026-10-02', pipelines: [], deals: [d('A', 100)] };
  const current = { date: '2026-10-09', pipelines: [], deals: [d('A', 100)] };
  const text = renderBrief(compareStateless(previous, current, [{ id: 'G', reason: 'capped', fields: ['close_date'], atT: atT('G', 70) }], '2026-10-09'));
  assert.match(text, /- Removed from HubSpot: -\$70 \(1\)/);
  assert.match(text, /\*\*Removed from HubSpot\*\* \(1\)\n- Deal G, \$70, o: was open in S/);
  assert.doesNotMatch(text, /- Could not rebuild:/);
  assert.match(text, /- Deal G, \$70, o: more than 20 changes to its close date since Oct 2; open then at \$70, gone from HubSpot now/);
});

test('renderBrief: the Could not rebuild section shows under its owner when grouped, and in Slack', () => {
  const text = renderBrief(statelessCase(), { groupBy: 'owner' });
  const group = text.slice(text.indexOf('## o, open'));
  assert.match(group, /\*\*Could not rebuild as of Oct 2\*\* \(3\)/);
  assert.match(toSlack(renderBrief(statelessCase())), /^\*Could not rebuild as of Oct 2\* \(3\)$/m);
  assert.match(toSlack(renderBrief(statelessCase())), /^• Could not rebuild: \+\$130 \(2\)$/m);
});

test('renderBrief: a slipped deal pushed two or more times since T says so; one push adds nothing', () => {
  const p = { ...d('S', 100), close_date: '2026-11-01' };
  const twice = { ...d('S', 100), close_date: '2026-12-15' };
  const previous = { date: '2026-10-02', pipelines: [], deals: [p, { ...p, id: 'O', name: 'Deal O' }] };
  const current = { date: '2026-10-09', pipelines: [], deals: [twice, { ...twice, id: 'O', name: 'Deal O' }] };
  const text = renderBrief(compareStateless(previous, current, [], '2026-10-09', { pushes: new Map([['S', 2], ['O', 1]]) }));
  assert.match(text, /- Deal S, \$100, o: Nov 1 → Dec 15 \(\+44 days, pushed 2 times\)/);
  assert.match(text, /- Deal O, \$100, o: Nov 1 → Dec 15 \(\+44 days\)\n/);
});

test('renderBrief: a merged record gone today prints its id with no made-up amount or owner', () => {
  const previous = { date: '2026-10-02', pipelines: [], deals: [d('A', 100)] };
  const current = { date: '2026-10-09', pipelines: [], deals: [d('A', 100)] };
  const text = renderBrief(compareStateless(previous, current, [{ id: 'M', reason: 'merged', fields: UNKNOWN_FIELDS, sources: ['S1', 'S2'] }], '2026-10-09'));
  assert.match(text, /^- Deal M: merged since Oct 2 from records S1 and S2, so what they held then is unknown, gone from HubSpot now$/m);
});

// A stage at T that the layout at T does not hold (a deleted pipeline, a deleted stage with no
// audit, or an audit that starts after T) gives no status at T: unknown, never open.
const buildAt = (live, audits = new Map()) => buildStateless({ live, archived: [], pipelines: PIPELINES, audits, owners: OWNERS, T: T0, now: NOW0, previousDate: '2026-10-02', date: '2026-10-09' });

test('buildStateless: a deal whose stage at T is in a since-deleted pipeline could not be rebuilt; it never counts as open then', () => {
  const live = [
    rec('1', { history: { amount: [v('10000', BEFORE)] } }),
    rec('2', { history: { amount: [v('50000', BEFORE)], pipeline: [v('default', after(10)), v('legacy', BEFORE)], dealstage: [v('won', after(10)), v('lwon', BEFORE)] } }),
  ];
  const out = buildAt(live);
  assert.deepEqual(out.previous.deals.map((x) => x.id), ['1']);
  assert.deepEqual(out.unknown.map((u) => [u.id, u.reason, u.fields]), [['2', 'layout', ['status', 'stage_order']]]);
  const r = compareStateless(out.previous, out.current, out.unknown, out.current.date);
  assert.equal(r.bridge.start, cents(10000));
  assert.deepEqual(r.won, []);
  const text = renderBrief(r);
  assert.match(text, /Closed 0 won and 0 lost\./);
  assert.match(text, /flat on last week \(the Oct 2 total leaves out 1 deal whose state then could not be rebuilt\)/);
  assert.match(text, /Deal 2\][^\n]*: its stage on Oct 2 is not in the pipeline settings HubSpot kept for that date[^\n]*, so its state then is unknown/);
});

test('buildStateless: a pipeline whose audit starts after T sends every deal in it to could-not-rebuild', () => {
  const late = new Map([['default', [{ action: 'UPDATE', timestamp: after(5), rawObject: JSON.stringify({ pipelineId: 'default', label: 'Sales', stages: [] }) }]]]);
  const out = buildAt([rec('1'), rec('3', { history: { dealstage: [v('b', BEFORE)] } })], late);
  assert.deepEqual(out.previous.deals, []);
  assert.deepEqual(out.unknown.map((u) => [u.id, u.reason]).sort(), [['1', 'layout'], ['3', 'layout']]);
  const r = compareStateless(out.previous, out.current, out.unknown, out.current.date);
  assert.equal(r.bridge.start, 0);
  assert.equal(r.startBreakdown.unknownCount, 2);
});

test('buildStateless: a partly rebuilt deal whose stage at T is not in the layout is not partial: its status then is unknown', () => {
  const capped = rec('5', { history: { pipeline: [v('legacy', BEFORE)], dealstage: [v('lopen', BEFORE)], closedate: Array.from({ length: 20 }, (_, i) => v(`2026-12-${String(i + 1).padStart(2, '0')}T00:00:00Z`, after(100 - i))) } });
  const out = buildAt([capped]);
  assert.deepEqual(out.unknown.map((u) => [u.id, u.reason, u.fields]), [['5', 'capped', ['close_date', 'status', 'stage_order']]]);
  const r = compareStateless(out.previous, out.current, out.unknown, out.current.date);
  assert.equal(r.bridge.start, 0);
  assert.equal(r.startBreakdown.knownCount, 0);
});

test('buildStateless keeps one record per deal id, so a paging overlap or a deal archived between listings never unbalances the bridge', () => {
  const capped = (extra) => rec('9', { ...extra, history: { amount: [v('700', BEFORE)], closedate: Array.from({ length: 20 }, (_, i) => v(`2026-12-${String(i + 1).padStart(2, '0')}T00:00:00Z`, after(100 - i))) } });
  const live = [rec('1'), rec('1'), capped()];
  const archived = [capped({ archivedAt: after(200) })];
  const out = buildStateless({ live, archived, pipelines: PIPELINES, audits: new Map(), owners: OWNERS, T: T0, now: NOW0, previousDate: '2026-10-02', date: '2026-10-09' });
  assert.deepEqual(out.unknown.map((u) => u.id), ['9']);
  assert.deepEqual(out.previous.deals.map((x) => x.id), ['1']);
  const r = compareStateless(out.previous, out.current, out.unknown, out.current.date);
  assert.equal(r.bridge.start, cents(800));
});

test('renderBrief: a could-not-rebuild deal whose amount then is known says it, even when its state then is not', () => {
  const previous = { date: '2026-10-02', pipelines: [], deals: [] };
  const current = { date: '2026-10-09', pipelines: [], deals: [d('H', 70)] };
  const text = renderBrief(compareStateless(previous, current, [{ id: 'H', reason: 'capped', fields: ['stage_id', 'status', 'stage_order'], atT: atT('H', 50) }], '2026-10-09'));
  assert.match(text, /- Deal H, \$70, o: more than 20 changes to its stage since Oct 2, so its state then is unknown \(amount then \$50\)$/m);
});

test('renderBrief: a deal listed under both Removed from HubSpot and Could not rebuild says so on its Could not rebuild line', () => {
  const previous = { date: '2026-10-02', pipelines: [], deals: [] };
  const current = { date: '2026-10-09', pipelines: [], deals: [] };
  const text = renderBrief(compareStateless(previous, current, [{ id: 'G', reason: 'capped', fields: ['close_date'], atT: atT('G', 70) }], '2026-10-09'));
  assert.match(text, /- Deal G, \$70, o: more than 20 changes to its close date since Oct 2; open then at \$70, gone from HubSpot now \(also under Removed from HubSpot\)$/m);
});

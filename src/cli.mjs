// Command-line entry. Everything the outside world provides (env, fetch, clock, streams) is
// injected, so the whole CLI runs under test with no network and no real token.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, accessSync, statSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHubSpotClient, HubSpotError, validToken, BAD_TOKEN_MESSAGE } from './hubspot.mjs';
import { buildSnapshot } from './snapshot.mjs';
import { writeSnapshot, findPrevious } from './store.mjs';
import { compare } from './compare.mjs';
import { renderBrief, unknownStageLine, GROUP_BY } from './render.mjs';
import { postToSlack, validSlackWebhook, BAD_WEBHOOK_MESSAGE } from './slack.mjs';
import { statelessRead, buildStateless, compareStateless, StatelessRefusal } from './stateless.mjs';

const DEMO_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo');
export const DEMO_DATES = ['2026-09-28', '2026-10-05'];

export const NPX = 'npx github:derrtaderr/monday-pipeline-brief';
const DEFAULT_INVOCATION = 'node bin/monday-brief.mjs';

// How the user started us, so every message shows a command that exists for them.
export function invocationFor(scriptPath, cwd) {
  if (!scriptPath) return DEFAULT_INVOCATION;
  if (/[\\/](_npx|node_modules)[\\/]/.test(scriptPath)) return NPX;
  const rel = relative(cwd, scriptPath);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? `node ${rel}` : `node ${scriptPath}`;
}

export function usage(cmd = DEFAULT_INVOCATION) {
  return `monday-pipeline-brief: the weekly "what changed" HubSpot pipeline brief

Usage:
  ${cmd} demo [--out FILE] [--group-by owner|pipeline]
      Sample brief from bundled fictional data. No token needed.
  ${cmd} run --since 7d [--out FILE] [--no-next-step] [--large-deal AMOUNT]
      [--group-by owner|pipeline]
      Stateless: rebuild your pipeline as it was 7 days ago (1d to 90d) from
      HubSpot property history and compare it with today. Works on the first
      run, keeps no snapshot and writes nothing but --out. --as-of 2026-10-01T09:00:00Z
      compares with an exact instant instead. Needs the settings.currencies.read
      scope too, and refuses (exit 5) a portal with more than one currency.
  ${cmd} run [--dir DIR] [--out FILE] [--no-next-step] [--large-deal AMOUNT]
      [--group-by owner|pipeline]
      Stored snapshots: snapshot your HubSpot deals and write this week's brief.
      DIR and FILE may start with ~; --dir=DIR and --out=FILE also work.
      --no-next-step: for teams that do not use HubSpot's Next step field;
      the stale check then looks only at last activity.
      --large-deal AMOUNT: a deal this size or larger goes to "Look at these
      first" on one warning sign (50000, 50K, 1.5M, or off). Default: the
      largest open deals, at most 10% of them (at least one, unless every
      deal above $0 has the same amount and they outnumber that limit).
      --group-by owner|pipeline: one heading per rep or pipeline. Default: one list.
  ${cmd} help
      Show this help.

Environment:
  HUBSPOT_TOKEN       HubSpot service key or private app token (scopes crm.objects.deals.read, crm.objects.owners.read). Required for run.
  SLACK_WEBHOOK_URL   Optional Slack incoming webhook. When set, run also posts the brief there.
  MONDAY_BRIEF_DIR    Snapshot folder when --dir is not given. Default ~/.monday-pipeline-brief
  MONDAY_BRIEF_NEXT_STEP=off   Same as --no-next-step (handy in a scheduled job's env file).
  MONDAY_BRIEF_LARGE_DEAL      Same as --large-deal; the flag wins when both are set.
  MONDAY_BRIEF_GROUP_BY        Same as --group-by; the flag wins when both are set.
  MONDAY_BRIEF_SINCE           Same as --since (stateless mode); the flags win.
`;
}

function localDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const eq = /^--(out|dir|large-deal|group-by|since|as-of)=(.*)$/s.exec(a);
    if (a === '--help' || a === '-h') {
      flags.help = true;
    } else if (a === '--no-next-step') {
      flags.nextStep = false;
    } else if (eq) {
      if (!eq[2]) throw new UsageError(`--${eq[1]} needs a value`);
      flags[eq[1]] = eq[2];
    } else if (['--out', '--dir', '--large-deal', '--group-by', '--since', '--as-of'].includes(a)) {
      if (!args[i + 1]) throw new UsageError(`${a} needs a value`);
      flags[a.slice(2)] = args[++i];
    } else {
      throw new UsageError(`Unknown option "${a}"`);
    }
  }
  return flags;
}

// A folder or file value as typed: one layer of matching quotes (left by env files and
// plists, where the shell does not strip them) is removed, and a leading ~ means home.
export function pathValue(value, home, cwd) {
  const unquoted = /^(["'])(.*)\1$/s.exec(value)?.[2] ?? value;
  return resolve(cwd, unquoted.replace(/^~(?=$|[\\/])/, home));
}

class UsageError extends Error {}

const AMOUNT = /^\$?(\d+(?:\.\d+)?)([km])?$/i;

// A large-deal setting as typed: dollars (50000, 75,000, $50K, 1.5M), or off. Unset is
// undefined, which means the default (the largest open deals, at most 10% of them). Anything else throws.
export function largeDealSetting(value, name = '--large-deal') {
  const v = (value ?? '').trim().replace(/^(["'])(.*)\1$/s, '$2').replace(/,/g, '');
  if (!v) return undefined;
  if (/^off$/i.test(v)) return false;
  const m = AMOUNT.exec(v);
  if (!m) throw new UsageError(`${name} needs an amount in dollars such as 50000, 50K or 1.5M, or off (got "${value}")`);
  const scale = { k: 1e3, m: 1e6 }[m[2]?.toLowerCase()] ?? 1;
  return Math.round(Number(m[1]) * scale * 100) / 100;
}

// Second line of defence: no message printed by the CLI may carry a secret, even one that
// arrived inside an unexpected exception.
export function redact(text, env = {}) {
  let out = String(text);
  for (const secret of [env.HUBSPOT_TOKEN, env.SLACK_WEBHOOK_URL]) {
    const s = secret?.trim();
    if (s) out = out.split(s).join('[redacted]');
  }
  return out
    .replace(/\bpat-[a-z0-9]+-[0-9a-f-]{8,}/gi, '[redacted]')
    .replace(/https:\/\/hooks\.slack\.com\/\S+/gi, '[redacted]');
}

// Deal data is private: new folders are 0700 and new files 0600.
export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;

function writeFile(file, text) {
  mkdirSync(dirname(file), { recursive: true, mode: DIR_MODE });
  writeFileSync(file, text, { mode: FILE_MODE });
}

export function demoBrief({ groupBy = null, largeDeal } = {}) {
  const [prev, curr] = DEMO_DATES.map((d) => JSON.parse(readFileSync(join(DEMO_DIR, `snapshot-${d}.json`), 'utf8')));
  return renderBrief(compare(prev, curr, curr.date, { largeDeal }), { groupBy });
}

// --group-by wins over MONDAY_BRIEF_GROUP_BY; either must name owner or pipeline.
export function groupBySetting(flag, env) {
  const [value, name] = flag !== undefined ? [flag, '--group-by'] : [env, 'MONDAY_BRIEF_GROUP_BY'];
  const v = (value ?? '').trim().replace(/^(["'])(.*)\1$/s, '$2').toLowerCase();
  if (!v) return null;
  if (!GROUP_BY.includes(v)) throw new UsageError(`${name} must be owner or pipeline (got "${value}")`);
  return v;
}

// Settings shared by run and demo, flag first, then env.
function briefSettings(flags, env) {
  return {
    groupBy: groupBySetting(flags['group-by'], env.MONDAY_BRIEF_GROUP_BY),
    largeDeal: flags['large-deal'] !== undefined
      ? largeDealSetting(flags['large-deal'])
      : largeDealSetting(env.MONDAY_BRIEF_LARGE_DEAL, 'MONDAY_BRIEF_LARGE_DEAL'),
  };
}

// Stateless mode's comparison instant: --since Nd (1 to 90 days before now) or --as-of an ISO
// instant with a time and a zone, in the past and at most 90 days ago (HubSpot keeps archived
// deals for 90 days). MONDAY_BRIEF_SINCE stands in for --since when neither flag is given.
// Returns null for stored mode. Anything else is a usage error.
export const MAX_SINCE_DAYS = 90;
const DAY_MS = 86400000;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export function asOfSetting({ since, asOf }, env, now) {
  if (since !== undefined && asOf !== undefined) throw new UsageError('Give --since or --as-of, not both');
  if (asOf !== undefined) {
    const v = asOf.trim().replace(/^(["'])(.*)\1$/s, '$2');
    if (!ISO_INSTANT.test(v) || Number.isNaN(Date.parse(v))) throw new UsageError(`--as-of needs an ISO instant with a time and a zone, such as 2026-10-01T09:00:00Z (got "${asOf}")`);
    // Date.parse rolls 2026-09-31 over to Oct 1; a date must name a real calendar day.
    const [y, mo, d] = v.slice(0, 10).split('-').map(Number);
    const day = new Date(Date.UTC(y, mo - 1, d));
    if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) {
      throw new UsageError(`--as-of names a date that does not exist (${v.slice(0, 10)})`);
    }
    const t = new Date(v);
    if (t >= now) throw new UsageError(`--as-of must be in the past (got "${asOf}")`);
    if (now - t > MAX_SINCE_DAYS * DAY_MS) throw new UsageError(`--as-of must be at most ${MAX_SINCE_DAYS} days ago: HubSpot keeps deleted deals for ${MAX_SINCE_DAYS} days (got "${asOf}")`);
    return t;
  }
  const [value, name] = since !== undefined ? [since, '--since'] : [env.MONDAY_BRIEF_SINCE, 'MONDAY_BRIEF_SINCE'];
  const v = (value ?? '').trim().replace(/^(["'])(.*)\1$/s, '$2');
  if (!v) return null;
  const m = /^(\d+)d$/i.exec(v);
  const days = m ? Number(m[1]) : NaN;
  if (!(days >= 1 && days <= MAX_SINCE_DAYS)) throw new UsageError(`${name} needs a number of days from 1 to ${MAX_SINCE_DAYS}, such as 7d (got "${value}")`);
  return new Date(now.getTime() - days * DAY_MS);
}

export const DEFAULT_DIR = '.monday-pipeline-brief';

// Every run appends one line to <dir>/run.log, so a scheduled run that failed is visible
// even when cron or launchd swallowed its output. Logging never fails the run.
function appendRunLog(dir, now, code, messages, env, stderr) {
  const file = join(dir, 'run.log');
  try {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    const text = messages.join(' ').replace(/\s+/g, ' ').trim();
    appendFileSync(file, `${now.toISOString()} exit=${code} ${redact(text, env)}\n`, { mode: FILE_MODE });
  } catch (err) {
    stderr.write(`Warning: could not add a line to ${file} (${err.code ?? 'error'}).\n`);
  }
}

// The brief location is checked before HubSpot is called, like the snapshot folder.
function checkWritable(file) {
  mkdirSync(dirname(file), { recursive: true, mode: DIR_MODE });
  accessSync(dirname(file), constants.W_OK);
  let stat;
  try {
    stat = statSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  if (stat.isDirectory()) throw Object.assign(new Error('is a folder'), { code: 'EISDIR' });
  accessSync(file, constants.W_OK);
}

async function runCommand(flags, ctx) {
  const home = ctx.home ?? homedir();
  const dir = pathValue(flags.dir ?? (ctx.env.MONDAY_BRIEF_DIR || join(home, DEFAULT_DIR)), home, ctx.cwd);
  const messages = [];
  const stderr = { write: (s) => { messages.push(s); return ctx.stderr.write(s); } };
  let code = 1;
  try {
    code = await runInner(flags, { ...ctx, stderr }, dir);
    return code;
  } catch (err) {
    messages.push(`Unexpected error: ${err?.message ?? err}`);
    throw err;
  } finally {
    appendRunLog(dir, ctx.now, code, messages, ctx.env, ctx.stderr);
  }
}

async function runInner(flags, ctx, dir) {
  const { env, stdout, stderr } = ctx;
  const token = env.HUBSPOT_TOKEN?.trim();
  if (!token) {
    stderr.write(`HUBSPOT_TOKEN is not set. Create a HubSpot service key (or a private app on older accounts) as the README quickstart shows, then export HUBSPOT_TOKEN.\nTo see a sample brief without a token, run: ${ctx.invocation ?? DEFAULT_INVOCATION} demo\n`);
    return 1;
  }
  if (!validToken(token)) {
    stderr.write(`${BAD_TOKEN_MESSAGE}\nNothing was fetched from HubSpot.\n`);
    return 1;
  }
  const hook = env.SLACK_WEBHOOK_URL?.trim();
  if (hook && !validSlackWebhook(hook)) {
    stderr.write(`${BAD_WEBHOOK_MESSAGE}\nNothing was fetched from HubSpot.\n`);
    return 1;
  }
  try {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    accessSync(dir, constants.W_OK);
  } catch (err) {
    stderr.write(`Cannot write to the snapshot folder ${dir} (${err.code ?? 'error'}). Choose a folder you can write to with --dir or MONDAY_BRIEF_DIR.\n`);
    return 1;
  }
  try {
    accessSync(dir, constants.R_OK);
  } catch (err) {
    stderr.write(`Cannot read the snapshot folder ${dir} (${err.code ?? 'error'}). Choose a folder you can read and write with --dir or MONDAY_BRIEF_DIR.\n`);
    return 1;
  }
  const briefFile = flags.out ? pathValue(flags.out, ctx.home ?? homedir(), ctx.cwd) : null;
  if (briefFile) {
    try {
      checkWritable(briefFile);
    } catch (err) {
      stderr.write(`Cannot write the brief to ${briefFile} (${err.code ?? 'error'}). Choose a location you can write to with --out. Nothing was fetched from HubSpot.\n`);
      return 1;
    }
  }
  const date = localDate(ctx.now);
  const client = createHubSpotClient({ token, fetch: ctx.fetch, sleep: ctx.sleep });

  let snapshot;
  try {
    const [deals, pipelines, owners] = [await client.listDeals(), await client.listPipelines(), await client.listOwners()];
    snapshot = buildSnapshot({ deals, pipelines, owners, takenAt: ctx.now, date });
  } catch (err) {
    if (!(err instanceof HubSpotError)) throw err;
    stderr.write(`${err.message}\nNo snapshot or brief was written.\n`);
    return 2;
  }

  // Today's snapshot is written first, so a bad older file can never stop history accruing.
  let snapFile;
  try {
    snapFile = writeSnapshot(dir, snapshot);
  } catch (err) {
    stderr.write(`Could not save today's snapshot in ${dir} (${err.code ?? 'error'}). No snapshot or brief was written.\n`);
    return 4;
  }
  const { snapshot: previous, skipped } = findPrevious(dir, date);
  for (const s of skipped) stderr.write(`Skipped ${s.file} (${s.reason}). Move or delete it to silence this warning.\n`);
  if (skipped.length && !previous) stderr.write('No earlier readable snapshot, so this brief is treated as a first run.\n');
  const nextStep = !(flags.nextStep === false || /^(off|false|0|no)$/i.test(env.MONDAY_BRIEF_NEXT_STEP ?? ''));
  const result = compare(previous, snapshot, date, { nextStep, largeDeal: flags.largeDeal });
  const brief = renderBrief(result, { skipped, groupBy: flags.groupBy });
  const unknown = unknownStageLine(result.unknownStage);
  if (unknown) stderr.write(`Warning: ${unknown}\n`);
  const target = briefFile ?? join(dir, `brief-${date}.md`);
  stdout.write(brief);
  try {
    writeFile(target, brief);
  } catch (err) {
    stderr.write(`Could not write the brief to ${target} (${err.code ?? 'error'}). Today's snapshot was saved as ${basename(snapFile)} in ${dir}. The brief was printed above; fix the location and re-run (a same-day re-run is safe).\n`);
    return 4;
  }
  stderr.write(flags.out
    ? `Saved ${basename(snapFile)} in ${dir} and the brief to ${target}\n`
    : `Saved ${basename(snapFile)} and ${basename(target)} in ${dir}\n`);

  if (hook) {
    const sent = await postToSlack(hook, brief, ctx.fetch);
    if (!sent.ok) {
      stderr.write(`Slack post failed (${sent.reason}). The brief is saved at ${target}. Check SLACK_WEBHOOK_URL.\n`);
      return 3;
    }
    stderr.write('Posted the brief to Slack.\n');
  }
  return 0;
}

// Stateless mode: the comparison snapshot is rebuilt from HubSpot property history at asOf. It
// writes no snapshot (neither the rebuilt one, which a later stored run could mistake for a real
// read, nor today's) and no run.log; the brief goes to stdout, --out and Slack only.
async function statelessCommand(flags, ctx, asOf) {
  const { env, stdout, stderr } = ctx;
  const token = env.HUBSPOT_TOKEN?.trim();
  if (!token) {
    stderr.write(`HUBSPOT_TOKEN is not set. Create a HubSpot service key (or a private app on older accounts) as the README quickstart shows, then export HUBSPOT_TOKEN.\nTo see a sample brief without a token, run: ${ctx.invocation ?? DEFAULT_INVOCATION} demo\n`);
    return 1;
  }
  if (!validToken(token)) {
    stderr.write(`${BAD_TOKEN_MESSAGE}\nNothing was fetched from HubSpot.\n`);
    return 1;
  }
  const hook = env.SLACK_WEBHOOK_URL?.trim();
  if (hook && !validSlackWebhook(hook)) {
    stderr.write(`${BAD_WEBHOOK_MESSAGE}\nNothing was fetched from HubSpot.\n`);
    return 1;
  }
  const briefFile = flags.out ? pathValue(flags.out, ctx.home ?? homedir(), ctx.cwd) : null;
  if (briefFile) {
    try {
      checkWritable(briefFile);
    } catch (err) {
      stderr.write(`Cannot write the brief to ${briefFile} (${err.code ?? 'error'}). Choose a location you can write to with --out. Nothing was fetched from HubSpot.\n`);
      return 1;
    }
  }
  const client = createHubSpotClient({ token, fetch: ctx.fetch, sleep: ctx.sleep });
  let built;
  try {
    const read = await statelessRead(client, asOf);
    built = buildStateless({ ...read, T: asOf, now: ctx.now, previousDate: localDate(asOf), date: localDate(ctx.now) });
  } catch (err) {
    if (err instanceof StatelessRefusal) {
      stderr.write(`${err.message}\nNo brief was written.\n`);
      return 5;
    }
    if (!(err instanceof HubSpotError)) throw err;
    stderr.write(`${err.message}\nNo brief was written.\n`);
    return 2;
  }
  const nextStep = !(flags.nextStep === false || /^(off|false|0|no)$/i.test(env.MONDAY_BRIEF_NEXT_STEP ?? ''));
  const result = compareStateless(built.previous, built.current, built.unknown, built.current.date, { nextStep, largeDeal: flags.largeDeal, pushes: built.pushes });
  const brief = renderBrief(result, { groupBy: flags.groupBy });
  const unknown = unknownStageLine(result.unknownStage);
  if (unknown) stderr.write(`Warning: ${unknown}\n`);
  stdout.write(brief);
  // In a terminal the brief is on screen. Anywhere else (a pipe, a scheduled job, /dev/null) the
  // printed copy may be the only one, so no message may point back at it as if it were kept.
  const onlyPrinted = stdout.isTTY
    ? 'The brief was printed above.'
    : 'The brief went to standard output only and was not saved; add --out FILE to keep a copy.';
  if (briefFile) {
    try {
      writeFile(briefFile, brief);
    } catch (err) {
      stderr.write(`Could not write the brief to ${briefFile} (${err.code ?? 'error'}). ${onlyPrinted}\n`);
      return 4;
    }
  }
  stderr.write(`Stateless run: compared with HubSpot as of ${asOf.toISOString()}; no snapshot was saved${briefFile ? `; the brief was saved to ${briefFile}` : ''}.\n`);
  if (hook) {
    const sent = await postToSlack(hook, brief, ctx.fetch);
    if (!sent.ok) {
      stderr.write(`Slack post failed (${sent.reason}). ${briefFile ? `The brief is saved at ${briefFile}.` : onlyPrinted} Check SLACK_WEBHOOK_URL.\n`);
      return 3;
    }
    stderr.write('Posted the brief to Slack.\n');
  } else if (!briefFile && !stdout.isTTY) {
    stderr.write('The brief went to standard output only: it was not saved or posted anywhere. Add --out FILE or set SLACK_WEBHOOK_URL to keep it.\n');
  }
  return 0;
}

function help(ctx) {
  ctx.stdout.write(usage(ctx.invocation));
  return 0;
}

export async function main(argv, ctx) {
  const [command, ...rest] = argv;
  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') return help(ctx);
    if (command === 'demo') {
      const flags = parseFlags(rest);
      if (flags.help) return help(ctx);
      if (flags.dir !== undefined) throw new UsageError('--dir is for run; demo reads bundled sample data');
      const brief = demoBrief(briefSettings(flags, ctx.env));
      ctx.stdout.write(brief);
      ctx.stderr.write(`This was sample data from a made-up HubSpot portal, so its links go nowhere useful. Set HUBSPOT_TOKEN and run \`${ctx.invocation ?? DEFAULT_INVOCATION} run --since 7d\` for your own pipeline.\n`);
      if (flags.out) {
        const file = pathValue(flags.out, ctx.home ?? homedir(), ctx.cwd);
        try {
          writeFile(file, brief);
        } catch (err) {
          ctx.stderr.write(`Could not write the demo brief to ${file} (${err.code ?? 'error'}). The brief above was printed but not saved.\n`);
          return 4;
        }
        ctx.stderr.write(`Saved the demo brief to ${file}\n`);
      }
      return 0;
    }
    if (command === 'run') {
      const flags = parseFlags(rest);
      if (flags.help) return help(ctx);
      Object.assign(flags, briefSettings(flags, ctx.env));
      const asOf = asOfSetting({ since: flags.since, asOf: flags['as-of'] }, ctx.env, ctx.now);
      if (asOf) {
        if (flags.dir !== undefined) {
          throw new UsageError(flags.since === undefined && flags['as-of'] === undefined
            ? '--dir is for stored snapshots, but MONDAY_BRIEF_SINCE turns on stateless mode, which keeps no snapshot folder. Unset MONDAY_BRIEF_SINCE to use --dir.'
            : '--dir is for stored snapshots; stateless mode (--since or --as-of) keeps no snapshot folder');
        }
        return await statelessCommand(flags, ctx, asOf);
      }
      return await runCommand(flags, ctx);
    }
    throw new UsageError(`Unknown command "${command}"`);
  } catch (err) {
    if (err instanceof UsageError) {
      ctx.stderr.write(`${err.message}\n\n${usage(ctx.invocation)}`);
      return 1;
    }
    ctx.stderr.write(`Unexpected error: ${redact(err?.message ?? err, ctx.env)}\n`);
    return 1;
  }
}

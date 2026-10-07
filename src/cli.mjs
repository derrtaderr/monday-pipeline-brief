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
import { renderBrief, unknownStageLine } from './render.mjs';
import { postToSlack, validSlackWebhook, BAD_WEBHOOK_MESSAGE } from './slack.mjs';

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
  ${cmd} demo [--out FILE]
      Sample brief from bundled fictional data. No token needed.
  ${cmd} run [--dir DIR] [--out FILE] [--no-next-step]
      Snapshot your HubSpot deals and write this week's brief.
      DIR and FILE may start with ~; --dir=DIR and --out=FILE also work.
      --no-next-step: for teams that do not use HubSpot's Next step field;
      the stale check then looks only at last activity.
  ${cmd} help
      Show this help.

Environment:
  HUBSPOT_TOKEN       HubSpot service key or private app token (scopes crm.objects.deals.read, crm.objects.owners.read). Required for run.
  SLACK_WEBHOOK_URL   Optional Slack incoming webhook. When set, run also posts the brief there.
  MONDAY_BRIEF_DIR    Snapshot folder when --dir is not given. Default ~/.monday-pipeline-brief
  MONDAY_BRIEF_NEXT_STEP=off   Same as --no-next-step (handy in a scheduled job's env file).
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
    const eq = /^--(out|dir)=(.*)$/s.exec(a);
    if (a === '--help' || a === '-h') {
      flags.help = true;
    } else if (a === '--no-next-step') {
      flags.nextStep = false;
    } else if (eq) {
      if (!eq[2]) throw new UsageError(`--${eq[1]} needs a value`);
      flags[eq[1]] = eq[2];
    } else if (a === '--out' || a === '--dir') {
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

export function demoBrief() {
  const [prev, curr] = DEMO_DATES.map((d) => JSON.parse(readFileSync(join(DEMO_DIR, `snapshot-${d}.json`), 'utf8')));
  return renderBrief(compare(prev, curr, curr.date));
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
  const result = compare(previous, snapshot, date, { nextStep });
  const brief = renderBrief(result, { skipped });
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
      const brief = demoBrief();
      ctx.stdout.write(brief);
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

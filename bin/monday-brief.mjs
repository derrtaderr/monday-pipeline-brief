#!/usr/bin/env node
import { main, invocationFor } from '../src/cli.mjs';

const code = await main(process.argv.slice(2), {
  env: process.env,
  fetch: globalThis.fetch,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  stdout: process.stdout,
  stderr: process.stderr,
  now: new Date(),
  cwd: process.cwd(),
  invocation: invocationFor(process.argv[1], process.cwd()),
});
process.exitCode = code;

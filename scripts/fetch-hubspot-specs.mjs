// Downloads the HubSpot OpenAPI specs the contract tests read, at one pinned commit, into a
// folder you choose. The specs are HubSpot's and are not redistributed with this repo.
// Usage: node scripts/fetch-hubspot-specs.mjs DIR && HUBSPOT_SPEC_DIR=DIR npm test
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPEC_REPO = 'HubSpot/HubSpot-public-api-spec-collection';
export const SPEC_SHA = 'b123c5de888fd6405fab85db9c8560ce4e61dfc6';
export const SPEC_FILES = {
  deals: { path: 'PublicApiSpecs/CRM/Deals/Rollouts/424/v3/deals.json', saveAs: 'deals.json' },
  pipelines: { path: 'PublicApiSpecs/CRM/Pipelines/Rollouts/145896/v3/pipelines.json', saveAs: 'pipelines.json' },
  owners: { path: 'PublicApiSpecs/CRM/Crm Owners/Rollouts/146888/v3/crmOwners.json', saveAs: 'crmOwners.json' },
};

// Written last, after every spec file, so a folder holding it was fully downloaded at SPEC_SHA.
export const MARKER = 'spec-sha.txt';
const REFETCH = 're-run the fetch script: node scripts/fetch-hubspot-specs.mjs DIR';

// null when the folder was fetched at the pinned commit, else a message saying what is wrong.
export function checkSpecDir(dir) {
  let sha;
  try {
    sha = readFileSync(join(dir, MARKER), 'utf8').trim();
  } catch {
    return `${join(dir, MARKER)} is missing, so the specs in ${dir} cannot be traced to the pinned commit; ${REFETCH}`;
  }
  if (sha !== SPEC_SHA) return `The specs in ${dir} were fetched at ${sha.slice(0, 7)}, not the pinned ${SPEC_SHA.slice(0, 7)}; ${REFETCH}`;
  return null;
}

export async function main(dir, { fetch = globalThis.fetch, stdout = process.stdout, stderr = process.stderr } = {}) {
  if (!dir) {
    stderr.write('Usage: node scripts/fetch-hubspot-specs.mjs DIR\n');
    return 1;
  }
  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, MARKER), { force: true });
  for (const { path, saveAs } of Object.values(SPEC_FILES)) {
    const url = `https://raw.githubusercontent.com/${SPEC_REPO}/${SPEC_SHA}/${encodeURI(path)}`;
    let res;
    let body;
    try {
      res = await fetch(url);
      if (res.ok) body = await res.text();
    } catch (err) {
      stderr.write(`Could not reach raw.githubusercontent.com to download ${path} (${err?.message ?? err}). Check your connection and run this again.\n`);
      return 1;
    }
    if (!res.ok) {
      stderr.write(`Could not download ${path} (status ${res.status}).\n`);
      return 1;
    }
    writeFileSync(join(dir, saveAs), body);
  }
  writeFileSync(join(dir, MARKER), `${SPEC_SHA}\n`);
  stdout.write(`Saved ${Object.keys(SPEC_FILES).length} spec files to ${resolve(dir)}. Now run: HUBSPOT_SPEC_DIR=${dir} npm test\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv[2]);
}

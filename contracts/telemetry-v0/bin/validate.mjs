#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validateLines } from '../lib/validate.mjs';

let failed = false;
for (const file of process.argv.slice(2)) {
  const errors = validateLines(readFileSync(file, 'utf8').split('\n'));
  for (const e of errors) console.error(`${file}:${e.line}: ${e.message}`);
  if (errors.length) failed = true;
  else console.log(`${file}: ok`);
}
process.exit(failed ? 1 : 0);

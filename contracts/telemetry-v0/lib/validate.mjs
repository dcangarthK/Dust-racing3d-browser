import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, '..', 'schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateMessage = ajv.compile(schema);

/** Validate NDJSON lines against schema v0 plus cross-line rules. Returns [] when valid. */
export function validateLines(lines) {
  const errors = [];
  let lastSeq = -1;
  let sessionId = null;
  const eventIds = new Set();

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    if (raw.trim() === '') return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      errors.push({ line: lineNo, message: `invalid JSON: ${e.message}` });
      return;
    }
    if (!validateMessage(msg)) {
      const detail = validateMessage.errors
        .map((e) => `${e.instancePath || '/'} ${e.message}${e.params?.missingProperty ? ` (${e.params.missingProperty})` : ''}`)
        .join('; ');
      errors.push({ line: lineNo, message: `schema: ${detail}` });
      return;
    }
    if (sessionId === null) sessionId = msg.sessionId;
    else if (msg.sessionId !== sessionId) errors.push({ line: lineNo, message: `sessionId changed from ${sessionId} to ${msg.sessionId}` });
    if (msg.seq <= lastSeq) errors.push({ line: lineNo, message: `seq ${msg.seq} not greater than previous ${lastSeq}` });
    lastSeq = Math.max(lastSeq, msg.seq);
    if (msg.type === 'event') {
      if (eventIds.has(msg.eventId)) errors.push({ line: lineNo, message: `duplicate eventId ${msg.eventId}` });
      eventIds.add(msg.eventId);
    }
  });
  return errors;
}

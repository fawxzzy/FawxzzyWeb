import { createHash } from 'node:crypto';
import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import { parseCandidateOperationsJson } from './development-operations-json.mjs';
import { verifyCandidateOperationsIntegrity } from './development-operations-integrity.mjs';

// Reviewed local copies of the five immutable Socials schemas. No input selects
// a file, supplies a schema, causes a remote $ref fetch, or grants producer trust.
const sources = [
  ['card.v1', '2b1f0e69cc5fce7ab484b01ae215317c4cff3a5c7466e149b1c9ca13fb3ae6f8'],
  ['board.v1', 'd3d090a5ea4da52f17f10b048d81d1397676ff98e29ef6a6c1ffc557a5e8eb28'],
  ['event.v1', 'ef2f6cf081bcbbb1098482add1cd1e3b7ebc62a34e698be6cf8e14b018d4f41e'],
  ['board.v2', '3e2dc041aa726196adc0eb482f29ea00c246b2df4501892efa0de11266ed2aed'],
  ['event.v2', '8f82f40ce944f570b3fcdacb3c4a9e3a866b4e5905f7f4fa7e57e4936b4cfe40']
];
const ajv = new Ajv2020({ strict: true, allErrors: false, coerceTypes: false, useDefaults: false, removeAdditional: false });
const fullDateTime = formats.get('date-time', 'full').validate;
// Retain RFC3339's zone syntax and local component ranges even in the library's
// leap-second branch. It checks dates/leap position; no string is normalized.
const dateTimeSyntax = /^\d{4}-\d{2}-\d{2}[Tt](?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)(?![\s\S])/u;
ajv.addFormat('date-time', { type: 'string', validate: (value) => dateTimeSyntax.test(value) && fullDateTime(value) });
const validators = new Map();
for (const [name, expectedHash] of sources) {
  const bytes = fs.readFileSync(new URL(`../../contracts/v1/operations/source-schemas/development-${name}.schema.json`, import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('Candidate contribution schema pin mismatch');
  const schema = JSON.parse(bytes.toString('utf8'));
  const identity = `socials-os.development-${name}.schema.json`;
  if (schema.$id !== identity) throw new Error('Candidate contribution schema identity mismatch');
  validators.set(identity, ajv.compile(schema));
}

function reject(code) {
  const error = new TypeError(`Candidate operations contribution rejected: ${code}`);
  error.code = `ERR_OPERATIONS_CONTRIBUTION_${code}`;
  throw error;
}

/** Full candidate payload/schema and v2 binding checks, not trusted intake. */
export function verifyCandidateOperationsContribution(envelopeInput, proofInput) {
  const digest = verifyCandidateOperationsIntegrity(envelopeInput, proofInput);
  const envelope = parseCandidateOperationsJson(envelopeInput);
  const validate = validators.get(envelope.schema_identity);
  // Integrity already admits only these exact identities; retain fail-closed
  // dispatch if the separate modules ever drift.
  if (!validate) reject('SCHEMA_IDENTITY');
  let valid;
  try { valid = validate(envelope.payload); }
  finally { validate.errors = null; } // Do not retain caller field names.
  if (!valid) reject('SCHEMA');
  if (Object.hasOwn(envelope.payload, 'contract_version')
      && (envelope.payload.contract_version !== envelope.schema_identity
          || envelope.payload.source_revision !== envelope.source_revision)) reject('V2_BINDING');
  return digest;
}

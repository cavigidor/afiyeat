// Reading and validating a fingerprint export (baseline/fingerprint.mjs, version 2).
// An export is accepted only if it is complete and internally consistent. Every problem is reported;
// nothing is repaired, skipped or guessed. A rejected export must be re-run, not edited.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { COVERAGE, FULL_TEXT, FINGERPRINT_FORMAT, FINGERPRINT_VERSION } from '../baseline/fingerprint.mjs';

const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const byteCmp = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

// Categories that exist in every Afiyeat database. Zero rows means the export did not see the catalog
// (wrong role, wrong database, a filtered or truncated copy), not that the schema is empty.
export const REQUIRED_NONEMPTY = ['table', 'column', 'constraint', 'index', 'policy', 'effective_policy', 'function',
  'function_acl', 'trigger', 'table_acl', 'schema_acl', 'role', 'publication', 'bucket'];

export class InvalidExport extends Error {
  constructor(problems, source) {
    super(`${source}: rejected, ${problems.length} problem(s):\n  - ${problems.slice(0, 40).join('\n  - ')}${problems.length > 40 ? `\n  - ... and ${problems.length - 40} more` : ''}`);
    this.problems = problems;
  }
}

/**
 * Accepts exactly what the export query returns: the JSON object, or that object as a JSON string
 * (a copied cell), or a one-row array [{"fingerprint": "..."}]. Nothing else.
 */
export function parseExportText(text, source = 'export') {
  let v;
  try { v = JSON.parse(text.trim()); } catch (e) { throw new InvalidExport([`not valid JSON (${e.message}); the copy may be truncated`], source); }
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { throw new InvalidExport([`string value is not valid JSON (${e.message})`], source); } }
  if (Array.isArray(v)) {
    if (v.length !== 1 || typeof v[0]?.fingerprint !== 'string') throw new InvalidExport(['an array must hold exactly one {"fingerprint": "..."} row'], source);
    try { v = JSON.parse(v[0].fingerprint); } catch (e) { throw new InvalidExport([`fingerprint cell is not valid JSON (${e.message})`], source); }
  }
  return v;
}

/** Validate; returns the export with a Map of rows keyed "category\tkey". Throws InvalidExport. */
export function validateExport(fp, source = 'export') {
  const p = [];
  if (fp === null || typeof fp !== 'object' || Array.isArray(fp)) throw new InvalidExport(['top level must be an object'], source);
  const expected = ['format', 'version', 'coverage', 'server_version_num', 'database', 'generated_at', 'part', 'parts', 'row_count', 'checksum', 'rows'];
  if (fp.part !== 1 || fp.parts !== 1) p.push(`this is part ${fp.part} of ${fp.parts}: give every part (they are merged before checking)`);
  for (const k of expected) if (!(k in fp)) p.push(`missing field "${k}"`);
  for (const k of Object.keys(fp)) if (!expected.includes(k)) p.push(`unexpected field "${k}"`);
  if (fp.format !== FINGERPRINT_FORMAT) p.push(`format is ${JSON.stringify(fp.format)}, expected ${FINGERPRINT_FORMAT}`);
  if (fp.version !== FINGERPRINT_VERSION) p.push(`version is ${JSON.stringify(fp.version)}, expected ${FINGERPRINT_VERSION}: re-run the current export query`);
  const cov = Array.isArray(fp.coverage) ? fp.coverage : [];
  if (!Array.isArray(fp.coverage)) p.push('coverage must be an array');
  const want = Object.keys(COVERAGE);
  for (const c of want) if (!cov.includes(c)) p.push(`coverage lacks "${c}"`);
  for (const c of cov) if (!want.includes(c)) p.push(`coverage has unknown category "${c}"`);
  if (new Set(cov).size !== cov.length) p.push('coverage lists a category twice');
  if (!Number.isInteger(fp.server_version_num) || fp.server_version_num < 120000) p.push('server_version_num must be an integer >= 120000');
  if (typeof fp.database !== 'string' || !fp.database) p.push('database must be a non-empty string');
  if (typeof fp.generated_at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(fp.generated_at)) p.push('generated_at must be an ISO UTC timestamp');
  if (typeof fp.checksum !== 'string' || !/^[0-9a-f]{32}$/.test(fp.checksum)) p.push('checksum must be 32 hex characters');
  if (!Array.isArray(fp.rows)) { p.push('rows must be an array'); throw new InvalidExport(p, source); }
  if (fp.row_count !== fp.rows.length) p.push(`row_count says ${fp.row_count} but ${fp.rows.length} rows are present: the export is incomplete`);

  const map = new Map();
  const counts = Object.fromEntries(want.map((c) => [c, 0]));
  let prev = null;
  fp.rows.forEach((r, i) => {
    const at = `row ${i + 1}`;
    if (r === null || typeof r !== 'object' || Array.isArray(r)) { p.push(`${at}: not an object`); return; }
    const keys = Object.keys(r).sort().join(',');
    if (keys !== 'c,d,h,k') { p.push(`${at}: fields must be exactly c, k, h, d (got ${keys})`); return; }
    const { c, k, h, d } = r;
    if (typeof c !== 'string' || !want.includes(c)) { p.push(`${at}: unknown category ${JSON.stringify(c)}`); return; }
    if (typeof k !== 'string' || k.length === 0) { p.push(`${at}: empty key in ${c}`); return; }
    if (typeof h !== 'string' || !/^[0-9a-f]{32}$/.test(h)) p.push(`${at} ${c} ${k}: hash is not 32 hex characters`);
    if (FULL_TEXT.has(c)) {
      if (typeof d !== 'string') p.push(`${at} ${c} ${k}: full definition missing`);
      else if (md5(d) !== h) p.push(`${at} ${c} ${k}: definition does not match its hash (edited or damaged)`);
    } else if (d !== null) p.push(`${at} ${c} ${k}: this category is hash-only; d must be null`);
    const id = `${c}\t${k}`;
    if (map.has(id)) p.push(`${at}: duplicate ${c} ${k}`);
    if (prev !== null && (byteCmp(prev.c, c) > 0 || (prev.c === c && byteCmp(prev.k, k) >= 0)) && !map.has(id)) p.push(`${at}: rows are out of order (export reordered or merged)`);
    prev = { c, k };
    map.set(id, { c, k, h, d });
    counts[c]++;
  });
  for (const c of REQUIRED_NONEMPTY) if (counts[c] === 0) p.push(`no ${c} rows: the export did not see the catalog (wrong role, database, or a partial copy)`);
  const sorted = [...map.values()].sort((a, b) => byteCmp(a.c, b.c) || byteCmp(a.k, b.k));
  const sum = md5(sorted.map((r) => `${r.c}\t${r.k}\t${r.h}`).join('\n'));
  if (sum !== fp.checksum) p.push('checksum does not match the rows: the export is incomplete or was altered');
  if (p.length) throw new InvalidExport(p, source);
  return { ...fp, map, counts };
}

/** Merge the parts of one split export. Parts must agree on everything except rows and generated_at. */
export function mergeParts(list, source = 'export') {
  if (list.length === 1) return list[0];
  const p = [];
  const n = list[0]?.parts;
  if (!Number.isInteger(n) || n !== list.length) p.push(`expected ${n} parts, got ${list.length}`);
  const seen = new Set(list.map((x) => x.part));
  for (let i = 1; i <= list.length; i++) if (!seen.has(i)) p.push(`part ${i} is missing`);
  for (const k of ['format', 'version', 'server_version_num', 'database', 'parts', 'row_count', 'checksum']) {
    if (new Set(list.map((x) => JSON.stringify(x[k]))).size !== 1) p.push(`parts disagree on ${k} (taken from different runs or different databases)`);
  }
  if (p.length) throw new InvalidExport(p, source);
  const ordered = [...list].sort((a, b) => a.part - b.part);
  return { ...ordered[0], part: 1, parts: 1, generated_at: ordered[0].generated_at, rows: ordered.flatMap((x) => x.rows ?? []) };
}

/** Read one export file, or several files that are the parts of one export. */
export function readExport(...files) {
  const list = files.map((f) => parseExportText(readFileSync(f, 'utf8'), f));
  return validateExport(mergeParts(list, files.join(' + ')), files.join(' + '));
}

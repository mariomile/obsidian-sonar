/**
 * Synthetic benchmark: build an index over ~7,000 documents and time queries,
 * asserting Sonar's performance budgets. Run with:
 *   node --experimental-strip-types scripts/bench.mjs
 *
 * Budgets (fail the process if exceeded):
 *   - cold build  < 3000 ms
 *   - query (avg) <   30 ms
 */
import { performance } from 'node:perf_hooks';
import { InvertedIndex } from '../src/index/inverted-index.ts';
import { extractFields } from '../src/index/field-extract.ts';
import { search } from '../src/index/search-core.ts';

const DOC_COUNT = 7200;
const TOKENS_PER_DOC = 250;
const VOCAB_SIZE = 4000;
const BUILD_BUDGET_MS = 3000;
const QUERY_BUDGET_MS = 30;

// Deterministic PRNG so runs are comparable.
let seed = 123456789;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}

const SYLL = ['ka', 'lo', 'mi', 're', 'tan', 'du', 'pro', 'stra', 'gen', 'vo', 'ce', 'ri', 'ma', 'to'];
function word() {
  const n = 2 + Math.floor(rand() * 3);
  let w = '';
  for (let i = 0; i < n; i++) w += pick(SYLL);
  return w;
}
const vocab = Array.from({ length: VOCAB_SIZE }, word);

function makeContent() {
  const words = [];
  for (let i = 0; i < TOKENS_PER_DOC; i++) words.push(pick(vocab));
  return words.join(' ');
}

const now = Date.now();

// ---- Build ----
const buildStart = performance.now();
const index = new InvertedIndex();
for (let i = 0; i < DOC_COUNT; i++) {
  const basename = `${pick(vocab)} ${pick(vocab)} ${i}`;
  const content = makeContent();
  const { fields, tags } = extractFields({ basename, content, meta: {} });
  index.addDocument({
    path: `notes/${basename}.md`,
    basename,
    mtime: now - Math.floor(rand() * 365) * 86_400_000,
    size: content.length,
    docType: 'md',
    tags,
    fields,
  });
}
const buildMs = performance.now() - buildStart;

// ---- Query ----
const queries = [];
for (let i = 0; i < 40; i++) {
  const a = pick(vocab);
  const b = pick(vocab);
  queries.push(rand() < 0.5 ? a.slice(0, 4) : `${a} ${b}`);
}
// Warm up.
for (const q of queries) search(index, q, { now });

const queryStart = performance.now();
const RUNS = 5;
for (let r = 0; r < RUNS; r++) for (const q of queries) search(index, q, { now });
const queryMs = (performance.now() - queryStart) / (RUNS * queries.length);

console.log(`docs indexed:   ${index.docCount}`);
console.log(`unique terms:   ${index.allTerms.length}`);
console.log(`cold build:     ${buildMs.toFixed(0)} ms  (budget ${BUILD_BUDGET_MS} ms)`);
console.log(`query avg:      ${queryMs.toFixed(2)} ms  (budget ${QUERY_BUDGET_MS} ms)`);

let failed = false;
if (buildMs > BUILD_BUDGET_MS) {
  console.error(`FAIL: cold build ${buildMs.toFixed(0)}ms exceeds ${BUILD_BUDGET_MS}ms`);
  failed = true;
}
if (queryMs > QUERY_BUDGET_MS) {
  console.error(`FAIL: query avg ${queryMs.toFixed(2)}ms exceeds ${QUERY_BUDGET_MS}ms`);
  failed = true;
}
if (failed) process.exit(1);
console.log('OK — within budgets');

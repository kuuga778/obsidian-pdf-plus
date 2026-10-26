import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { loadMethods, memoryIO, fixture, addHighlight, snapshot, sourcePaths } from '../tests/pdf-annotation-harness.mjs';
const { values } = parseArgs({ options: { baseline: { type: 'string' }, pdf: { type: 'string' }, iterations: { type: 'string', default: '3' } } });
if (!values.baseline) throw new Error('Pass --baseline <unmodified git ref>, for example --baseline 6a3218b9');
const iterations = Number(values.iterations);
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) throw new Error('Iterations must be 1 through 20');
const baseline = loadMethods(sourcePaths.map(file => execFileSync('git', ['show', values.baseline + ':' + file], { encoding: 'utf8' })));
const optimized = loadMethods();
const bytes = values.pdf ? readFileSync(values.pdf) : await fixture(424, 64);
const before = snapshot(await optimized.library.loadPdfLibDocumentFromArrayBuffer(bytes));
const results = { baseline: [], optimized: [] };
for (let i = 0; i < iterations; i++) {
    let expected;
    for (const name of i % 2 ? ['optimized', 'baseline'] : ['baseline', 'optimized']) {
        const runtime = memoryIO(name === 'baseline' ? baseline : optimized, bytes);
        const start = performance.now();
        await runtime.io.process({ path: 'in-memory-fixture.pdf' }, doc => addHighlight(runtime.io, doc));
        const elapsed = performance.now() - start;
        const actual = snapshot(await optimized.library.loadPdfLibDocumentFromArrayBuffer(runtime.output));
        if (expected) assert.deepEqual(actual, expected); else expected = actual;
        assert.deepEqual(runtime.counters, { reads: 1, writes: 1 });
        results[name].push(Math.round(elapsed));
    }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({ fixture: values.pdf ? 'provided local PDF (not uploaded)' : 'generated, copyright-free PDF', pages: before.length, bytes: bytes.length, iterations,
    baseline_ms: results.baseline, optimized_ms: results.optimized,
    baseline_median_ms: median(results.baseline), optimized_median_ms: median(results.optimized),
    page_contents_geometry_and_annotations_match: true, vault_reads_per_edit: 1, vault_writes_per_edit: 1,
    note: 'In-memory parse/modify/serialize only; excludes physical disk writes and Obsidian viewer reload. No source PDF is modified.' }, null, 2));

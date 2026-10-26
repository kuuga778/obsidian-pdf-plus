import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMethods, memoryIO, fixture, addHighlight, snapshot, pdfLib } from './pdf-annotation-harness.mjs';
const methods = loadMethods();
const input = fixture();

test('loader preserves readonly options and yields between larger parsing batches', async () => {
    const original = pdfLib.PDFDocument.load;
    const seen = [];
    pdfLib.PDFDocument.load = async (_bytes, options) => { seen.push(options); return {}; };
    try {
        await methods.library.loadPdfLibDocumentFromArrayBuffer(new Uint8Array());
        await methods.library.loadPdfLibDocumentFromArrayBuffer(new Uint8Array(), true);
        assert.deepEqual(seen.map(o => [o.ignoreEncryption, o.parseSpeed]), [[false, pdfLib.ParseSpeeds.Fast], [true, pdfLib.ParseSpeeds.Fast]]);
        assert.ok(Number.isFinite(seen[0].parseSpeed), 'The UI must still get opportunities to run');
    } finally { pdfLib.PDFDocument.load = original; }
});

test('adding a highlight preserves existing annotations and matches the default serializer', async () => {
    const bytes = await input;
    const expectedDoc = await pdfLib.PDFDocument.load(bytes);
    const ref = addHighlight(methods.io, expectedDoc);
    const expected = await pdfLib.PDFDocument.load(await expectedDoc.save());
    const runtime = memoryIO(methods, bytes);
    const returned = await runtime.io.process({ path: 'fixture.pdf' }, doc => addHighlight(runtime.io, doc));
    const actual = await pdfLib.PDFDocument.load(runtime.output);
    assert.equal(returned, ref);
    assert.deepEqual(snapshot(actual), snapshot(expected));
    assert.deepEqual(runtime.counters, { reads: 1, writes: 1 });
    assert.equal(snapshot(actual)[0].annotations.length, 3);
});

test('mutation failures propagate without writing the PDF', async () => {
    const runtime = memoryIO(methods, await input);
    const failure = new Error('mutation failed');
    await assert.rejects(runtime.io.process({}, () => { throw failure; }), error => error === failure);
    assert.equal(runtime.counters.writes, 0);
});

test('read failures propagate without mutation or writing', async () => {
    const failure = new Error('read failed');
    const runtime = memoryIO(methods, await input, { read: async () => { throw failure; } });
    let called = false;
    await assert.rejects(runtime.io.process({}, () => { called = true; }), error => error === failure);
    assert.equal(called, false);
    assert.equal(runtime.counters.writes, 0);
});

test('write failures propagate instead of reporting a saved annotation', async () => {
    const failure = new Error('write failed');
    const runtime = memoryIO(methods, await input, { write: async () => { throw failure; } });
    await assert.rejects(runtime.io.process({}, doc => addHighlight(runtime.io, doc)), error => error === failure);
    assert.equal(runtime.counters.writes, 1);
    assert.equal(runtime.output, undefined);
});

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
export const pdfLib = require('@cantoo/pdf-lib');
const ts = require('typescript');
export const sourcePaths = ['src/lib/index.ts', 'src/lib/highlights/write-file/pdf-lib.ts'];
const root = new URL('../', import.meta.url);

// Compile only the real methods under test: the rest of the classes need Obsidian's UI.
function methods(source, className, names) {
    const tree = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
    const cls = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    if (!cls) throw new Error('Class not found: ' + className);
    const selected = names.map(name => {
        const method = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === name);
        if (!method) throw new Error('Method not found: ' + name);
        return method.getText(tree);
    });
    const compiled = ts.transpileModule('({' + selected.join('\n') + '})', {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    return runInNewContext(compiled, { ...pdfLib, Notice: class Notice {} });
}

export function loadMethods(sources = sourcePaths.map(file => readFileSync(new URL(file, root), 'utf8'))) {
    return {
        library: methods(sources[0], 'PDFPlusLib', ['loadPdfLibDocument', 'loadPdfLibDocumentFromArrayBuffer']),
        io: methods(sources[1], 'PdfLibIO', ['process', 'addAnnotation']),
    };
}

export function memoryIO(methods, bytes, hooks = {}) {
    const counters = { reads: 0, writes: 0 };
    let output;
    const app = { vault: {
        readBinary: async file => { counters.reads++; return hooks.read ? hooks.read(file) : bytes; },
        modifyBinary: async (file, data) => { counters.writes++; if (hooks.write) await hooks.write(file, data); output = data; },
    } };
    const lib = { ...methods.library, app, plugin: { manifest: { name: 'PDF++' } } };
    const io = { ...methods.io, app, lib };
    return { io, counters, get output() { return output; } };
}

export function addHighlight(io, doc, text = 'Synthetic test highlight') {
    return io.addAnnotation(doc.getPage(0), {
        Subtype: 'Highlight', Rect: [20, 20, 160, 35],
        QuadPoints: [20, 35, 160, 35, 20, 20, 160, 20],
        Contents: pdfLib.PDFHexString.fromText(text), T: pdfLib.PDFHexString.fromText('Test'),
        C: [1, 1, 0], CA: 0.2,
    }).toString();
}

export async function fixture(pages = 2, objectsPerPage = 0) {
    const doc = await pdfLib.PDFDocument.create();
    for (let i = 0; i < pages; i++) {
        const page = doc.addPage([600, 800]);
        page.drawText('Synthetic PDF annotation fixture, page ' + (i + 1));
        const refs = [];
        for (let j = 0; j < objectsPerPage; j++) refs.push(doc.context.register(doc.context.obj({
            Type: 'BenchmarkObject', Page: i, Index: j, Text: pdfLib.PDFString.of('Generated test data'),
        })));
        if (refs.length) page.node.set(pdfLib.PDFName.of('BenchmarkObjects'), doc.context.obj(refs));
    }
    const io = loadMethods().io;
    addHighlight(io, doc, 'Existing highlight');
    io.addAnnotation(doc.getPage(0), { Subtype: 'Link', Rect: [20, 100, 180, 115],
        A: { S: 'URI', URI: pdfLib.PDFString.of('https://example.com/') } });
    return doc.save({ objectsPerTick: 500 });
}

export function snapshot(doc) {
    const digest = data => createHash('sha256').update(data).digest('hex');
    return doc.getPages().map(page => {
        const annotations = page.node.Annots();
        const contents = page.node.Contents();
        const object = contents && doc.context.lookup(contents);
        const streams = object instanceof pdfLib.PDFArray ? object.asArray() : object ? [object] : [];
        return {
            width: page.getWidth(), height: page.getHeight(), crop: page.getCropBox(), rotation: page.getRotation().angle,
            contents: streams.map(ref => digest(doc.context.lookup(ref).getContents())),
            annotations: annotations ? annotations.asArray().map(ref => ({ ref: ref.toString(), dict: doc.context.lookup(ref).toString() })) : [],
        };
    });
}

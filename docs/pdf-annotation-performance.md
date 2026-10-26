# Direct-to-PDF annotation performance

This change reduces time spent yielding to timers during PDF parsing and annotation serialization. It does **not** reduce the number of vault reads or writes: each edit still reads once, serializes the full document, and writes once. Obsidian's viewer reload after a file modification remains outside this change.

## Changes

- Use the finite batch size `ParseSpeeds.Fast` (1,500 parsed objects per tick), instead of the library's default `Slow` (100).
- Serialize annotation edits with `objectsPerTick: 500`, instead of the default 50.
- Keep yielding between batches; do not use `Infinity`, caching, delayed saves, or skipped writes.
- Preserve existing encryption handling and error propagation.

## Validation

    pnpm install --frozen-lockfile
    pnpm test:pdf-annotation
    pnpm build
    pnpm lint

The five tests execute the actual TypeScript methods in isolation from Obsidian's UI. They check parser options, annotation round trips against the default serializer, mutation failures, read failures, and write failures. They also assert exactly one vault read and one vault write for a successful edit.

## Reproducible benchmark

From a checkout containing the unmodified base commit:

    node scripts/benchmark-pdf-annotation.mjs --baseline 6a3218b9c506076b405438489e614bc9e22b833b --iterations 3

The script creates a copyright-free 424-page PDF in memory, with many small indirect objects to exercise batching. It adds a highlight and compares the baseline and modified output for page content streams, geometry, and annotation dictionaries. No PDF is written to disk.

An optional `--pdf /path/to/local.pdf` argument reads a user-supplied PDF locally; it does not upload or modify the source file.

### Example result

Windows 10, Node.js 24.15.0, @cantoo/pdf-lib 2.4.3:

| Mode | Runs (ms) | Median (ms) |
| --- | --- | --- |
| Original defaults | 4,955 / 5,209 / 5,291 | 5,209 |
| Larger finite batches | 768 / 745 / 741 | 745 |

The generated fixture was 859,968 bytes. These measurements cover in-memory parse/modify/serialize operations, not complete UI or disk-save latency. Results depend on scheduling, hardware, and document structure. The benchmark validates document equivalence and I/O counts; it deliberately has no timing assertion.

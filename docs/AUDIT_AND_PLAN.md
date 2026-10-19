# Source audit, architecture and implementation plan

Audit date: 2026-10-19. Target repository: `chemaiatlas/chemdatadoctor-mcp`.

## Evidence and reuse decisions

| Existing source | Observed capability | Decision |
| --- | --- | --- |
| `src/core/engine.ts` | CAS format/checksum, conservative suggestions, date/embedded/multiple-number warnings, name whitespace cleanup, normalized duplicates, row limits | Reuse pure engine with owner authorization; retain behavior and regression tests |
| `src/core/files.ts` | CSV/TSV and XLS/XLSX parsing, Excel date flags, ZIP metadata checks, resource bounds, formula-safe export | Reuse parsing and guards; remove browser localization/export coupling; add local filesystem adapter |
| `src/workers/data.worker.ts` | Browser worker orchestration | Exclude; replace with local MCP orchestration |
| `src/components`, localization, guides, assets | Website/UI content | Exclude |
| deployment scripts/configuration, build output, internal planning docs | Website operations and internal context | Exclude entirely |
| existing tests | CAS, import/export, boundary cases | Port relevant regression expectations; add MCP and filesystem tests |

No formula parser, systematic chemical naming engine, substance identity lookup,
or registry membership validation was found in the cleaning core. Name normalization
means whitespace/invisible-character cleanup only. Formula checking is a new, limited
syntax parser, not evidence of chemical existence or plausibility.

## Open-source and privacy review

The original package is private and has no project-level license. The repository owner
explicitly authorized reuse during this task. The standalone distribution applies MIT
to authorized first-party code. Dependency licenses remain separate (see notices).
No website content, infrastructure files, credentials, environment files, analytics,
business integrations or private datasets are included. The two selected core files
were read in full: they contain pure parsing/cleaning code and no credentials,
external requests or internal configuration. Release checks inspect the standalone
source and dependency manifest; human rights review remains appropriate for any
future additions. Only this subdirectory is intended for publication, never the
parent repository or its history.

## Architecture

`stdio -> official MCP SDK -> strict tool schemas -> pure cleaning engine / bounded
formula parser -> local file adapter -> new result artifacts + compact summary`.

Tools: `validate_cas`, `normalize_names`, `validate_formulas`, `detect_duplicates`,
`clean_dataset`, `quality_report`. Every tool advertises input/output JSON Schemas.
Errors return `isError: true` and a structured code/message; schema-invalid arguments
are handled by the SDK. All issue records distinguish error, warning, automatic fix
and unverifiable result. CAS registration, identity matching, name semantics and
formula plausibility are always unverifiable offline.

Inline arrays are limited. Dataset paths are restricted to an explicitly configured
data root; result artifacts are created exclusively in a new directory. The source
is never overwritten, duplicate rows are retained, and suggestions requiring human
judgment are never automatically applied. Reports return counts by default and
bounded optional samples. Original cells are preserved in JSON artifacts.

## Implementation stages

1. Complete source/rights/privacy review and establish this standalone boundary.
2. Extract authorized pure core; implement schemas, tools, formula grammar, file
   boundaries, non-overwriting artifacts and compact reporting.
3. Test core regressions, malformed/boundary input, all tools, real stdio SDK client,
   output-schema validation, offline behavior and filesystem safety.
4. Produce English usage/client configuration, CI, license, notices and publishable
   repository/package checks. Do not push, publish or create a remote repository.

## Limits chosen for v0.1

20 MiB input file, 50,000 data rows, 200 columns, 2,000,000 cells, 100 sheets;
ZIP expanded size 100 MiB, 50 MiB per entry, ratio <= 1000. Input is bounded and
loaded in memory; this is not an unbounded streaming Excel reader. Larger files
must be split before use. Duplicate detection spans all rows in a single call;
separate chunks do not share duplicate state. Returned samples are opt-in, at most
20 rows. Raw output goes to local files, not automatically into model context.

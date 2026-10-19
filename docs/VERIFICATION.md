# Verification record

Date: 2026-10-19. Local runtime: Node.js 24.22.0, macOS.

- Standalone build and 25 automated tests pass.
- The source-only ZIP was extracted into a fresh temporary directory outside the
  parent project. `npm ci --offline --ignore-scripts --no-audit --no-fund`, build,
  all 25 tests, schema export and release-boundary checks pass there without any
  parent repository files or runtime network access.
- Official SDK client connects over real stdio, initializes, discovers all six
  tools, validates result schemas, calls tools and recovers from tool errors.
- Raw JSON-RPC tests negotiate protocol versions 2024-11-05, 2025-03-26 and
  2025-06-18, then list/call tools and check unknown-method errors and ping.
- All tool operations complete with network entry points blocked in the server
  process. There are no application-level outbound calls or environment secrets.
- File tests cover CSV/TSV, JSON arrays/objects, XLS/XLSX sheets and dates,
  normalized duplicates, numeric cell types, safe formula exports, malformed data,
  schema limits, 50,000-row files, oversize files, traversal and symlink escapes.
- Existing website core tests: 74 pass; no tracked website files were modified.
- npm production dependency audit reports zero known vulnerabilities. This is a
  point-in-time advisory result, not a guarantee of absence of vulnerabilities.
- License inventory retains notices for all 97 production dependency packages.
- Release-boundary scan detects no credential patterns/internal paths or
  application network/config access in the candidate first-party source.
- npm package dry-run succeeds and excludes parent website code/configuration.
- The SDK automation example returns a compact quality report without an LLM.

Cross-platform CI is configured but was not executed locally. Native Claude and
Codex GUI sessions were not launched; configuration follows their official docs.
These tests are interoperability smoke/regression tests, not a claim of full
official MCP conformance-suite certification.

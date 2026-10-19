# ChemDataDoctor MCP

An MIT-licensed, independent MCP server for local chemical data cleaning.
Repository target: `chemaiatlas/chemdatadoctor-mcp`.

No account, API key, subscription, hosted database or runtime network connection
is needed. All cleaning runs on your computer over **stdio**. The server makes no
outbound requests and includes no telemetry. Installation downloads open-source
dependencies; after installation it runs offline. Your MCP client controls what
tool inputs and outputs it sends to its model provider. Dataset tools return
counts by default; raw records stay in local artifacts.

## Install from source

Requires Node.js **22.12+** (Node.js 24 recommended) and npm.

```sh
cd chemdatadoctor-mcp
npm ci --ignore-scripts
npm test
npm run build
node dist/cli.js --data-root /absolute/path/to/data
```

The last command waits for an MCP client on stdin. Start the compiled CLI directly
in client configurations; npm startup banners must not enter the protocol stream.
Only the standalone repository needs to be checked out. No parent website files
are required. This project has not been published to npm or GitHub by this task.
When working from a ZIP, extract it and use its directory as the project root.

`--data-root` is required and must name an existing directory. Input file paths
are relative to that root, or absolute paths within it. Traversal and resolved
symlink escapes are rejected. `--output-root` is optional; its default is
`<data-root>/.chemdatadoctor-output`. Output directories are created only by
`clean_dataset`. Use a dedicated data directory containing only intended inputs.

## MCP client configuration

Replace all example paths, including the path to your Node executable if your
client does not inherit your shell's PATH. No environment variables are required.

### Claude Code

```sh
claude mcp add --transport stdio chemdatadoctor -- node /absolute/path/to/chemdatadoctor-mcp/dist/cli.js --data-root /absolute/path/to/data
```

See the [official Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

### Claude Desktop and clients accepting `mcpServers` JSON

Merge this entry into your client's MCP configuration:

```json
{
  "mcpServers": {
    "chemdatadoctor": {
      "command": "node",
      "args": [
        "/absolute/path/to/chemdatadoctor-mcp/dist/cli.js",
        "--data-root", "/absolute/path/to/data"
      ]
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.chemdatadoctor]
command = "node"
args = ["/absolute/path/to/chemdatadoctor-mcp/dist/cli.js", "--data-root", "/absolute/path/to/data"]
```

The `command`/`args` configuration follows the
[official OpenAI MCP documentation](https://developers.openai.com/codex/mcp/).
Configuration files with placeholders are included in `examples/`.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `validate_cas` | `values` (1–100 strings), `applyFixes=false` | Original/current values, format status, checksum validity, suggestions and categorized findings |
| `normalize_names` | `values` (1–100 strings), `applyFixes=true` | Whitespace/invisible-character cleanup, preserving case and chemical notation |
| `validate_formulas` | `values` (1–100 strings) | `valid_syntax`, `invalid` or `unverifiable`, atom counts and findings |
| `detect_duplicates` | `values` (1–1,000 strings) | Zero-based duplicate indexes and first occurrence; blank values ignored |
| `clean_dataset` | File `path` **or** small inline `rows`, `columns`, options below | Counts, new artifact paths, optional metadata samples |
| `quality_report` | Same dataset input | Counts and optional metadata samples; writes no files |

Every tool advertises input and output JSON Schemas through `tools/list`.
The exact generated schemas are in [docs/tool-schemas.json](docs/tool-schemas.json).
Unexpected fields are rejected. Each inline cell/string is limited to 10,000
characters; total tool arguments are limited to 1 MiB after schema validation.

Dataset options:

| Field | Meaning / default |
| --- | --- |
| `path` / `rows` | Exactly one required. `rows` is a two-dimensional array of scalar cells/nulls, at most 201 rows including an optional header |
| `columns` | Required `{ "cas": 0, "name": 1, "formula": 2 }`; name/formula optional; all indexes zero-based and distinct |
| `header` | `true`; first row is a header and is excluded from inspection |
| `sheetIndex` | `0`; zero-based workbook sheet index |
| `applyFixes` | `false`; only conservative CAS formatting and name whitespace fixes are applied |
| `sampleLimit` | `0`, at most 20; samples contain source row/status/issue codes, never full cells |

CSV/TSV and XLS/XLSX are supported. JSON accepts an array of row arrays, or an
array of flat objects. Object arrays require `header=true`; columns follow the
union of object keys in first-seen order. Null and absent cells become empty
strings. Nested objects/arrays are rejected. JSON `original` means parsed cell
values (not byte-for-byte JSON serialization); the source file is always retained.

## Examples

Validate and safely normalize identifiers:

```json
{"values":["67-64-1","CAS: 67–64–1","67-64-2","67641"],"applyFixes":true}
```

Call `validate_cas` with this input. The labeled identifier is normalized to
`67-64-1`. The wrong checksum and unseparated digits remain unchanged. The
`valid` flag means that the whole identifier has valid format/checksum, allowing
a safe formatting suggestion; it never means registered or matched to a substance.

Inspect a workbook without changing anything:

```json
{"path":"inventory.xlsx","sheetIndex":0,"columns":{"cas":0,"name":1,"formula":2}}
```

Call `quality_report` first, then call `clean_dataset` with `applyFixes=true` if
you want local cleaned copies. The result is:

```json
{
  "ok": true,
  "data": {
    "summary": {
      "totalRows": 4,
      "changedRows": 1,
      "duplicateRows": 1,
      "findings": {"error":2,"warning":2,"automatic_fix":2,"unverifiable":13},
      "rowsByCategory": {"error":1,"warning":2,"automatic_fix":1,"unverifiable":4},
      "issuesByCode": {"PREFIX":1,"NAME_WHITESPACE":1,"CAS_IDENTITY_UNVERIFIED":4,"NAME_IDENTITY_UNVERIFIED":4,"FORMULA_PLAUSIBILITY_UNVERIFIED":4,"DUPLICATE":1,"CHECKSUM":1,"FORMULA_SYNTAX":1,"FORMAT":1,"UNSUPPORTED_NOTATION":1}
    },
    "artifacts": {
      "results":"/data/.chemdatadoctor-output/run-unique/results.json",
      "report":"/data/.chemdatadoctor-output/run-unique/report.json",
      "csv":"/data/.chemdatadoctor-output/run-unique/cleaned.csv",
      "excel":"/data/.chemdatadoctor-output/run-unique/cleaned.xlsx"
    },
    "samples": []
  }
}
```

The numbers above illustrate the structure; counts depend on input. Each run
creates a unique directory, never overwrites an existing file and never removes
duplicate rows. `results.json` contains original and cleaned cells, source row
numbers (one-based, including the header), suggestions and all findings.
`report.json` contains counts only. CSV exports prefix potentially executable
formula strings with an apostrophe; JSON retains their exact text. XLSX exports
write strings as text and do not execute or propagate input formulas. Original
Excel formulas/macros, formatting and workbook metadata are not preserved in the
cleaned workbook; the input file remains untouched. Exported CSV/XLSX include
cleaned cells; diagnostic annotations live in JSON, avoiding column collisions.

For an automation example using the official SDK without an LLM or credentials:

```sh
node examples/workflow.mjs /absolute/path/to/data inventory.csv
```

## Findings, errors and limits

Findings distinguish `error`, `warning`, `automatic_fix` and `unverifiable`.
Multiple categories may apply to the same row. Summary `findings` counts events;
`rowsByCategory` counts affected rows; neither is an exclusive partition.
An invalid chemical cell is a successful tool execution with an error finding.
A failed operation returns `isError=true` and `{ "ok":false,"error":{"code":
"...","message":"..."} }`. Schema-invalid calls are rejected by the SDK and
may have text-only errors. Error codes and recovery are documented in
[docs/ERRORS.md](docs/ERRORS.md).

Files are limited to 20 MiB, 50,000 data rows, 200 columns, 2,000,000 cells across
all sheets and 100 sheets. A file cell may contain at most 10,000 characters.
ZIP metadata guards limit expanded size to 100 MiB and per-entry size to 50 MiB,
with a maximum compression ratio of 1000. Inputs are bounded and read into memory;
this version is not an unbounded streaming reader. Split larger inputs into
separate files. Cross-chunk duplicate detection is not shared across calls; to
find all duplicates, submit one file within the limits. Nothing is silently
truncated. File paths keep complete datasets out of model tool arguments and
responses. Optional samples contain metadata only.

CAS checks do not establish registration or substance identity. Names receive
no synonym resolution, translation or systematic naming. Formula grammar supports
all 118 element symbols, positive integer counts, nested `()`/`[]` groups and
hydrates such as `CuSO4·5H2O`. Charges, explicit isotopes, variables, polymer
notation, Unicode subscripts and whitespace are unverifiable. Unknown symbols,
unbalanced/empty groups and zero counts are errors. Nesting is limited to 16,
individual counts to 1,000,000 and element totals to 1,000,000,000. Formula syntax
does not validate bonding, plausibility, CAS/name correspondence or identity.

The root boundary is an application safeguard, not an OS sandbox against a
different local process racing filesystem changes. Output artifacts contain
user data; retain or delete them according to your own policy. Partial output
can remain after disk/permission failures; the source is still unchanged.

## Development and release preparation

```sh
npm test
npm run schemas
npm run licenses
npm run check:release
npm audit --omit=dev
npm pack --dry-run
```

Tests cover core regressions, abnormal/boundary inputs, real stdio negotiation,
tool discovery, all tool schemas and results, path safety, source preservation,
formula-safe exports and calls with network entry points disabled. CI is configured
for Node 22/24 on Linux, macOS and Windows. Local verification does not establish
that every native client or every OS has been tested.

The [source audit and architecture](docs/AUDIT_AND_PLAN.md) records reuse decisions
and the implementation plan. [Release instructions](docs/RELEASE.md) explain how
to publish only this standalone tree after owner review. Source and third-party
licenses are included; dependency versions and integrity hashes are locked.
No website operations, internal configuration or hosted data integrations are
included. No push or publication is performed by these commands.

## License

First-party code: [MIT](LICENSE). Reused cleaning core was explicitly authorized
by the original repository owner. Dependencies retain their respective licenses;
see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and `third-party-licenses/`.

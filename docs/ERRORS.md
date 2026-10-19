# Tool contracts and recovery

All six tools have authoritative input/output schemas in `tool-schemas.json`,
generated through an actual MCP `tools/list` call. Successful results have
`ok=true` and tool-specific `data`. Execution failures have `ok=false`, `error`
and MCP `isError=true`. SDK argument failures/unknown tools use MCP tool errors
and may omit `structuredContent`. Errors never include input cells, stack traces,
credentials or filesystem contents.

| Code | Cause | Recovery |
| --- | --- | --- |
| `INVALID_INPUT` | Handler-level schema validation | Match advertised schema; provide exactly one dataset source |
| `LIMIT` | Byte, row, column, cell, ZIP or inline argument limit | Split input; use file paths for small-context processing |
| `FILE_NOT_FOUND` | Input path cannot resolve | Check file exists within configured root |
| `PATH_DENIED` | Resolved input is outside root | Move intended data into the configured root |
| `TYPE` | Unsupported extension or non-regular input | Use supported local data files |
| `FILE_PARSE` | Malformed CSV/workbook, invalid encoding, empty CSV or malformed ZIP | Export a valid UTF-8 CSV or supported workbook |
| `JSON_PARSE` | Invalid JSON or invalid UTF-8 | Fix JSON syntax/encoding |
| `JSON_SHAPE` | Nested/mixed JSON records or incompatible header option | Supply homogeneous row arrays or flat object records |
| `SHEET` | Missing workbook sheet index | Select an existing zero-based index |
| `COLUMN` | Missing/duplicate selected columns or no columns | Select distinct existing zero-based columns |
| `EMPTY_FILE` | No data rows after header | Supply data or set `header=false` for headerless rows |
| `IO_ERROR` | Permissions, disk or unexpected local operation failure | Check local access/storage; source is unchanged |

`validate_cas`, `normalize_names`, `validate_formulas` and `detect_duplicates`
have no filesystem side effects. They report invalid chemical data as findings,
not failed operations. Every offline identity/plausibility limitation is explicitly
marked `unverifiable`. No registry lookup or external name resolution is attempted.
`quality_report` is read-only; `applyFixes=true` calculates a preview.
`clean_dataset` writes new result artifacts with exclusive creation. A write
failure can leave partial artifacts in its new run directory; never treat an
error response as a complete export. Input workbooks are treated as tabular values;
original file bytes stay at their original path.

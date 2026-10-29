import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkCas, checkFormula, duplicates, normalizeName } from './chemistry.js';
import { inspectDataset, readDataset, ToolError, writeArtifacts, type LocalRoots } from './dataset.js';

const text = z.string().max(10000);
const values = z.array(text).min(1).max(100);
const finding = z.object({ category: z.enum(['error', 'warning', 'automatic_fix', 'unverifiable']), code: z.string(), message: z.string() });
const findings = z.array(finding);
const cas = z.object({ original: z.string(), value: z.string(), valid: z.boolean(), status: z.enum(['healthy', 'fixable', 'warning', 'invalid', 'empty']), suggestion: z.string().optional(), findings });
const name = z.object({ original: z.string(), value: z.string(), suggestion: z.string(), findings });
const formula = z.object({ original: z.string(), status: z.enum(['valid_syntax', 'invalid', 'unverifiable']), atoms: z.record(z.number()), findings });
const categories = z.object({ error: z.number().int().nonnegative(), warning: z.number().int().nonnegative(), automatic_fix: z.number().int().nonnegative(), unverifiable: z.number().int().nonnegative() });
const summary = z.object({ totalRows: z.number().int(), changedRows: z.number().int(), duplicateRows: z.number().int(), findings: categories, rowsByCategory: categories, issuesByCode: z.record(z.number().int()) });
const sample = z.object({ sourceRow: z.number().int(), casStatus: z.string(), issueCodes: z.array(z.string()), duplicateOf: z.number().int().optional() });
const artifactPaths = z.object({ results: z.string(), report: z.string(), csv: z.string(), excel: z.string() });
const datasetInput = z.object({
  path: z.string().min(1).max(4096).optional(),
  rows: z.array(z.array(z.union([text, z.number().finite(), z.boolean(), z.null()])).max(200)).min(1).max(201).optional(),
  header: z.boolean().default(true),
  sheetIndex: z.number().int().min(0).max(99).default(0),
  columns: z.object({ cas: z.number().int().min(0).max(199), name: z.number().int().min(0).max(199).optional(), formula: z.number().int().min(0).max(199).optional() }).strict(),
  applyFixes: z.boolean().default(false),
  sampleLimit: z.number().int().min(0).max(20).default(0),
}).strict().refine(v => Boolean(v.path) !== Boolean(v.rows), 'Provide exactly one of path or rows.');
const error = z.object({ code: z.string(), message: z.string() });
const envelope = <T extends z.ZodTypeAny>(data: T) => z.object({ ok: z.boolean(), data: data.optional(), error: error.optional() }).strict();

export const toolSchemas = {
  validate_cas: { input: z.object({ values, applyFixes: z.boolean().default(false) }).strict(), output: envelope(z.object({ results: z.array(cas) })) },
  normalize_names: { input: z.object({ values, applyFixes: z.boolean().default(true) }).strict(), output: envelope(z.object({ results: z.array(name) })) },
  validate_formulas: { input: z.object({ values }).strict(), output: envelope(z.object({ results: z.array(formula) })) },
  detect_duplicates: { input: z.object({ values: z.array(text).max(1000).min(1) }).strict(), output: envelope(z.object({ total: z.number().int(), duplicates: z.array(z.object({ index: z.number().int(), duplicateOf: z.number().int(), key: z.string() })), findings })) },
  clean_dataset: { input: datasetInput, output: envelope(z.object({ summary, artifacts: artifactPaths, samples: z.array(sample) })) },
  quality_report: { input: datasetInput, output: envelope(z.object({ summary, samples: z.array(sample) })) },
};

const descriptions = {
  validate_cas: 'Check local CAS format/checksum. Optional conservative format fixes. Never verifies registration or substance identity. Up to 100 values.',
  normalize_names: 'Normalize whitespace/invisible characters only. Preserves capitalization and chemical notation; no systematic naming or synonym lookup. Up to 100 values.',
  validate_formulas: 'Check limited formula grammar: elements, integer counts, parentheses, brackets and hydrates. Charges/isotopes/polymers are unverifiable; no plausibility check.',
  detect_duplicates: 'Find repeated CAS identifiers using safe normalization, or exact text for uncertain values. Zero-based indexes. Does not remove rows or resolve identities.',
  clean_dataset: 'Clean a local CSV/TSV/XLS/XLSX/JSON file or small inline row array. Explicit zero-based column mapping. Writes new local artifacts; preserves source and originals. Default summary only.',
  quality_report: 'Read and inspect a dataset without writing files. Same path/row limits and zero-based mappings as clean_dataset. applyFixes previews safe fixes only. Default summary only.',
};

// Remote datasets are inline only. No input path or artifact path is exposed.
const remoteDatasetInput = datasetInput.innerType().omit({ path: true }).extend({
  rows: datasetInput.innerType().shape.rows.unwrap(),
}).strict();
const remoteSchemas = {
  ...toolSchemas,
  clean_dataset: { input: remoteDatasetInput, output: envelope(z.object({ summary, rows: z.array(z.array(z.union([text, z.number(), z.boolean()]))), samples: z.array(sample) })) },
  quality_report: { input: remoteDatasetInput, output: toolSchemas.quality_report.output },
};

export function createServer(roots: LocalRoots, options: { remote?: boolean } = {}) {
  const schemas = options.remote ? remoteSchemas : toolSchemas;
  const server = new McpServer({ name: 'chemdatadoctor-mcp', version: '0.1.0' }, { maxToolInputElements: 100000 });
  for (const toolName of Object.keys(schemas) as (keyof typeof toolSchemas)[]) {
    const schema = schemas[toolName];
    server.registerTool(toolName, {
      description: options.remote && ['clean_dataset', 'quality_report'].includes(toolName) ? 'Inspect inline rows with explicit zero-based column mappings. No server file access or persistence. clean_dataset returns cleaned rows; quality_report returns summary only.' : descriptions[toolName], inputSchema: schema.input, outputSchema: schema.output,
      annotations: { readOnlyHint: options.remote || toolName !== 'clean_dataset', destructiveHint: false, idempotentHint: options.remote || toolName !== 'clean_dataset', openWorldHint: false },
    }, async (raw: unknown) => {
      let output: Record<string, unknown>;
      try {
        // Parse again to retain refinements/defaults consistently across SDK releases.
        const args = schema.input.parse(raw);
        if (Buffer.byteLength(JSON.stringify(args)) > 1024 * 1024) throw new ToolError('LIMIT', options.remote ? 'Inline tool arguments exceed 1 MiB.' : 'Inline tool arguments exceed 1 MiB; use a local file.');
        let data: unknown;
        switch (toolName) {
          case 'validate_cas': { const a = toolSchemas.validate_cas.input.parse(args); data = { results: a.values.map(v => checkCas(v, a.applyFixes)) }; break; }
          case 'normalize_names': { const a = toolSchemas.normalize_names.input.parse(args); data = { results: a.values.map(v => normalizeName(v, a.applyFixes)) }; break; }
          case 'validate_formulas': { const a = toolSchemas.validate_formulas.input.parse(args); data = { results: a.values.map(checkFormula) }; break; }
          case 'detect_duplicates': { const a = toolSchemas.detect_duplicates.input.parse(args); data = duplicates(a.values); break; }
          default: {
            const a = options.remote ? remoteDatasetInput.parse(args) : datasetInput.parse(args);
            const sheet = await readDataset(a, roots);
            const inspected = inspectDataset(sheet, a);
            const samples = inspected.records.slice(0, a.sampleLimit).map(r => ({ sourceRow: r.sourceRow, casStatus: r.cas.status, issueCodes: r.findings.map(f => f.code), duplicateOf: r.duplicateOf }));
            data = { summary: inspected.summary, samples, ...(toolName === 'clean_dataset' ? options.remote ? { rows: [...(a.header ? [sheet.rows[0]] : []), ...inspected.records.map(r => r.cleaned)] } : { artifacts: await writeArtifacts(sheet, inspected, a, roots) } : {}) };
          }
        }
        output = { ok: true, data };
        schema.output.parse(output);
      } catch (cause) {
        const code = cause instanceof ToolError ? cause.code : cause instanceof z.ZodError ? 'INVALID_INPUT' : 'IO_ERROR';
        const message = cause instanceof ToolError ? cause.message : cause instanceof z.ZodError ? 'Arguments do not match the tool input schema.' : 'Local operation failed. Check file permissions and available disk space.';
        output = { ok: false, error: { code, message } };
      }
      return { isError: output.ok === false, content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output };
    });
  }
  return server;
}

# Standalone repository handoff

This directory is the entire intended root of `chemaiatlas/chemdatadoctor-mcp`.
Do not publish the parent website repository, parent Git history, deployment
files, installed modules, generated user artifacts, environment files or secrets.
The implementation task does not create a remote, push commits or publish npm.

Before an owner-approved release:

1. Run `npm ci --ignore-scripts`, `npm test`, `npm run schemas`, `npm run licenses`,
   `npm run check:release`, `npm audit --omit=dev` and `npm pack --dry-run`.
2. Copy this directory into an empty repository, excluding `node_modules`, `dist`,
   `artifacts`, `.git`, environment files and tarballs. Keep all source, tests,
   scripts, lockfile, licenses, examples, docs and `.github` workflow files.
3. Check the exact candidate tree for credentials/private configuration and
   confirm authorship and authorization for newly added code/data. Automated
   pattern checks are useful but not a proof that arbitrary future code is safe.
4. Initialize a fresh Git history only in the destination. Review files locally.
   Remote creation, pushing and publishing require a separate explicit decision.

CI validates schema drift and tests Node 22/24 on three operating systems. npm
packaging includes compiled runtime code, docs, examples and license notices.
The Git repository additionally includes source and tests. `npm pack --dry-run`
does not publish. No automated publishing workflow is provided.

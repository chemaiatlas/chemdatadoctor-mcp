# Contributing

Use Node.js 22.12 or later. Install with `npm ci --ignore-scripts` and run
`npm test`, `npm run schemas`, `npm run licenses` and `npm run check:release`.
Keep generated schemas and license inventory current when dependencies change.

Contributions must be compatible with the MIT license. Do not submit private
datasets, credentials, internal configuration, proprietary integrations or code
you are not authorized to license. Add tests for behavior changes, preserve
original data, and keep tool outputs bounded. Runtime outbound requests and
telemetry are outside this project's scope. File processing must stay local.

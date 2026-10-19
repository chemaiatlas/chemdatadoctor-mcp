# Third-party notices

First-party ChemDataDoctor MCP code is MIT-licensed. The original repository owner
authorized extraction of `engine.ts` and the parsing/guard portion of `files.ts`
from ChemDataDoctor. The standalone copy is distributed under this project's MIT
license; parent website code and operational files are not part of this release.

Direct runtime dependencies:

| Package | Version | License | Upstream |
| --- | --- | --- | --- |
| MCP TypeScript SDK | 1.32.1 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| Papa Parse | 5.5.3 | MIT | https://github.com/mholt/PapaParse |
| SheetJS Community Edition | 0.20.3 | Apache-2.0 | https://git.sheetjs.com/sheetjs/sheetjs |
| Zod | 3.25.76 | MIT | https://github.com/colinhacks/zod |

All production dependency versions, licenses, source URLs and integrity hashes
are recorded in `docs/dependency-inventory.json`; their license texts are retained
in `third-party-licenses/`. Dependencies are installed separately, not bundled into
the CLI. Build/test dependencies include TypeScript (Apache-2.0) and type packages
(MIT); retain their installed notices if redistributing them. SheetJS is obtained
from the upstream Community Edition distribution rather than the stale registry
release. There is no runtime CDN or remote chemical data connection.

Algorithm/protocol references:

- CAS check digit: https://www.cas.org/support/documentation/chemical-substances/checkdig
- MCP tools: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP SDK stdio/schema guidance: https://ts.sdk.modelcontextprotocol.io/server

CAS Registry Number is a trademark of the American Chemical Society. This project
is independent and does not imply endorsement, registry verification or substance
assignment verification.

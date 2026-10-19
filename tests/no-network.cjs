// Preloaded into the real server process during protocol tests.
const { syncBuiltinESMExports } = require('node:module');
const deny = () => { process.stderr.write('UNEXPECTED_NETWORK_ATTEMPT\n'); throw new Error('Network disabled by test'); };
for (const name of ['node:http', 'node:https']) {
  const mod = require(name); mod.request = deny; mod.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
require('node:dns').lookup = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();

const path = require('node:path');
const Mocha = require('mocha');

function run() {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 30000 });
  mocha.addFile(path.resolve(__dirname, '..', 'vscode-smoke.test.cjs'));
  return new Promise((resolve, reject) => {
    mocha.run(failures => failures ? reject(new Error(`${failures} smoke test(s) failed`)) : resolve());
  });
}

module.exports = { run };

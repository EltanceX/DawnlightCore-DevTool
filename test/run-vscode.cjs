const fs = require('node:fs');
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');

if (process.env.DAWNLIGHT_RUN_VSCODE_TEST !== '1') {
  console.log('VS Code smoke test skipped. Set DAWNLIGHT_RUN_VSCODE_TEST=1 to run it.');
  process.exit(0);
}

function findExecutable() {
  const candidates = [
    process.env.DAWNLIGHT_VSCODE_PATH,
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe')
      : undefined,
    process.platform === 'win32' ? 'D:\\Software\\VSCode\\Microsoft VS Code\\bin\\code.cmd' : undefined
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

async function main() {
  const vscodeExecutablePath = findExecutable();
  if (!vscodeExecutablePath) {
    throw new Error('VS Code executable not found. Set DAWNLIGHT_VSCODE_PATH to Code.exe.');
  }
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: path.resolve(__dirname, '..'),
    extensionTestsPath: path.resolve(__dirname, 'vscode-suite', 'index.cjs'),
    launchArgs: [path.resolve(__dirname, '..'), '--disable-gpu']
  });
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

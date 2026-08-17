const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runTests } = require('@vscode/test-electron');

if (process.env.DAWNLIGHT_RUN_VSIX_TEST !== '1') {
  console.log('VSIX acceptance test skipped. Set DAWNLIGHT_RUN_VSIX_TEST=1 to run it.');
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const vsixPath = path.join(root, 'dawnlight-shader-pack-tools-0.2.0.vsix');

function findExecutable() {
  const candidates = [
    process.env.DAWNLIGHT_VSCODE_PATH,
    process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd')
      : undefined,
    process.platform === 'win32' ? 'D:\\Software\\VSCode\\Microsoft VS Code\\bin\\code.cmd' : undefined
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate));
}

function installVsix(executable, extensionsDir, userDataDir) {
  const command = process.platform === 'win32' ? `"${executable}"` : executable;
  const result = spawnSync(command, [
    '--user-data-dir', userDataDir,
    '--extensions-dir', extensionsDir,
    '--install-extension', vsixPath,
    '--force'
  ], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(`VSIX installation failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function findInstalledExtension(extensionsDir) {
  const extensionDir = fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(extensionsDir, entry.name))
    .find(directory => {
      const packagePath = path.join(directory, 'package.json');
      if (!fs.existsSync(packagePath)) return false;
      return JSON.parse(fs.readFileSync(packagePath, 'utf8')).name === 'dawnlight-shader-pack-tools';
    });
  if (!extensionDir) throw new Error('Installed Dawnlight extension was not found.');
  return extensionDir;
}

async function removeTemporaryProfile(tempRoot) {
  const retryableCodes = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!retryableCodes.has(error.code)) {
        console.warn(`Could not remove temporary profile ${tempRoot}: ${error.message}`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  console.warn(`VS Code left a locked temporary profile; remove it later: ${tempRoot}`);
}

async function main() {
  if (!fs.existsSync(vsixPath)) {
    throw new Error(`Missing ${path.basename(vsixPath)}. Run npm run package first.`);
  }
  const executable = findExecutable();
  if (!executable) throw new Error('VS Code CLI not found. Set DAWNLIGHT_VSCODE_PATH.');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnlight-vsix-'));
  const userDataDir = path.join(tempRoot, 'user-data');
  const extensionsDir = path.join(tempRoot, 'extensions');
  fs.mkdirSync(userDataDir);
  fs.mkdirSync(extensionsDir);
  try {
    installVsix(executable, extensionsDir, userDataDir);
    const installedExtension = findInstalledExtension(extensionsDir);
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: installedExtension,
      extensionTestsPath: path.resolve(__dirname, 'vscode-suite', 'index.cjs'),
      launchArgs: [
        root,
        '--disable-gpu',
        '--user-data-dir', userDataDir,
        '--extensions-dir', extensionsDir
      ],
      reuseMachineInstall: true
    });
  } finally {
    await removeTemporaryProfile(tempRoot);
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});

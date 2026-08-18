const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const engineRoot = process.env.DAWNLIGHT_ENGINE_REPO;

if (!engineRoot) {
  console.log('Engine Analyzer acceptance skipped; set DAWNLIGHT_ENGINE_REPO to the Survivalcraft repository.');
  process.exit(0);
}

const project = path.join(engineRoot, 'tools', 'ShaderPackAnalyzer', 'ShaderPackAnalyzer.csproj');
const sidecar = path.join(engineRoot, 'tools', 'ShaderPackAnalyzer', 'bin', 'Release', 'net10.0',
  'shaderpack-analyzer.dll');
const packRoot = process.env.DAWNLIGHT_ENGINE_TEST_PACK ||
  path.join(engineRoot, 'Survivalcraft', 'shaderpacks', 'Dawnlight_v3.1');
const catalogPath = process.env.DAWNLIGHT_CATALOG_PATH ||
  path.join(root, 'catalogs', 'dawnlight-3.1.catalog.json');

for (const [label, target] of [['Analyzer project', project], ['test pack', packRoot], ['Catalog', catalogPath]]) {
  assert.ok(fs.existsSync(target), `${label} does not exist: ${target}`);
}

if (process.env.DAWNLIGHT_SKIP_ENGINE_BUILD !== '1') {
  execFileSync('dotnet', ['build', project, '-c', 'Release', '--nologo'], {
    cwd: engineRoot,
    stdio: 'inherit'
  });
}
assert.ok(fs.existsSync(sidecar), `Analyzer sidecar was not built: ${sidecar}`);

process.env.DAWNLIGHT_CATALOG_PATH = catalogPath;
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const { DawnlightAnalyzerClient } = require('../packages/language-server/dist/analyzerClient');

async function main() {
  const client = new DawnlightAnalyzerClient({
    analyzerPath: sidecar,
    catalogHash: catalog.hash,
    timeoutMs: 10000,
    restartLimit: 0,
    onStderr: text => process.stderr.write(text)
  });
  try {
    const exported = await client.getCatalog({
      clientSupportedVersions: [1],
      expectedCatalogHash: catalog.hash
    });
    assert.ok(exported, 'Production Analyzer did not return a valid Catalog.');
    assert.equal(exported.catalogHash, catalog.hash);
    assert.equal(exported.compatible, true);

    const valid = await client.validatePack({
      packRoot,
      catalogHash: catalog.hash,
      requestVersion: 1,
      overlays: []
    });
    assert.ok(valid, 'Production Analyzer did not return a validatePack result.');
    assert.equal(valid.valid, true);
    assert.match(valid.manifestHash || '', /^[0-9a-f]{64}$/);

    const invalid = await client.validatePack({
      packRoot,
      catalogHash: catalog.hash,
      requestVersion: 2,
      overlays: [{ path: 'shaderpack.json', version: 2, content: '{}' }]
    });
    assert.ok(invalid, 'Production Analyzer did not return the overlay result.');
    assert.equal(invalid.valid, false);
    assert.equal(invalid.diagnostics[0]?.code, 'DLMAN0001');
    assert.equal(invalid.diagnostics[0]?.pointer, '/manifestVersion');
    console.log(`Engine Analyzer acceptance passed: ${exported.catalogHash}`);
  } finally {
    await client.shutdown();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

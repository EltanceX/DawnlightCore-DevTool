# Dawnlight Shader Pack VS Code Extension V2 Benchmark

## Purpose

`npm run benchmark` measures the hot paths introduced by V2 using a deterministic temporary shader pack. It does not read the Survivalcraft source tree or launch VS Code, so results are suitable for local regression checks and CI smoke runs.

The benchmark covers:

- initial workspace discovery, JSONC composition, and symbol indexing;
- one changed-fragment incremental rebuild;
- warm dynamic completion latency (p50 and p95);
- one fast cross-file diagnostic computation.
- one warm request through a temporary stdio Analyzer sidecar.

## Targets

| Measurement | Target |
| --- | ---: |
| Initial discovery/index | `< 1000 ms` |
| Incremental fragment rebuild | `< 300 ms` |
| Warm completion p95 | `< 50 ms` |
| Fast diagnostics | `< 250 ms` |
| Analyzer warm response | `< 2000 ms` |

The synthetic pack contains 96 options, 48 resources, one program, one pass, and one Settings control. This keeps the input stable while exercising realistic index and completion paths. The benchmark prints results on every run; threshold overruns are warnings by default. Set `DAWNLIGHT_BENCHMARK_STRICT=1` to make an overrun fail the command.

## Running

```powershell
npm run benchmark
$env:DAWNLIGHT_BENCHMARK_STRICT = '1'
npm run benchmark
```

Run the benchmark after a clean build when comparing changes. Absolute timings depend on CPU, filesystem cache, Node.js version, and background load; compare repeated runs on the same machine rather than treating one noisy sample as a regression.

## Release gate

The `0.2.0` release gate requires the benchmark command to complete, `npm test` and `npm run lint` to pass, and the packaged VSIX acceptance test to pass in an isolated VS Code profile. A threshold warning is recorded in the release notes when strict mode is not used; a strict-mode failure blocks release acceptance.

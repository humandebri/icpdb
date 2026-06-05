#!/usr/bin/env node
// Where: scripts/icpdb-local-sdk-smoke.mjs
// What: Entrypoint for the package-built ICPDB SQL SDK live smoke.
// Why: Keep the documented smoke command stable while the runner holds the live checks.

await import("./icpdb-local-sdk-smoke-runner.mjs");

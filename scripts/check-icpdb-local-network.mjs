#!/usr/bin/env node
// Where: scripts/check-icpdb-local-network.mjs
// What: Verify local smoke network diagnosis helpers.
// Why: Long local smokes should fail with actionable network and port-conflict context.
import assert from "node:assert/strict";
import {
  formatLocalNetworkSetupError,
  listenerSummaryForPort,
  portFromLauncherError,
  summarizeLsofOutput
} from "./icpdb-local-network.mjs";

assert.equal(portFromLauncherError("Failed to bind to address 127.0.0.1:8001: Address already in use"), "8001");
assert.equal(portFromLauncherError("pocket-ic instance running with gateway port 8001"), "8001");
assert.equal(portFromLauncherError("network launcher exited"), "");

const lsofOutput = [
  "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME",
  "node    12345 user   20u  IPv4 0xabc    0t0      TCP 127.0.0.1:8001 (LISTEN)"
].join("\n");
assert.equal(summarizeLsofOutput(lsofOutput), "node pid 12345 TCP 127.0.0.1:8001 (LISTEN)");
assert.equal(summarizeLsofOutput("COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n"), "");

const listener = await listenerSummaryForPort("8001", async (command, args) => {
  assert.equal(command, "lsof");
  assert.deepEqual(args, ["-nP", "-iTCP:8001", "-sTCP:LISTEN"]);
  return { stdout: lsofOutput };
});
assert.equal(listener, "node pid 12345 TCP 127.0.0.1:8001 (LISTEN)");

const noListener = await listenerSummaryForPort("", async () => {
  throw new Error("should not call lsof without a port");
});
assert.equal(noListener, "");

const error = formatLocalNetworkSetupError(
  "local-icpdb",
  "gateway port",
  "the local-icpdb network for this project is not running\n",
  "Failed to bind to address 127.0.0.1:8001: Address already in use",
  listener
);
assert.match(error, /run: icp network start -d -e local-icpdb/);
assert.match(error, /network launcher stderr: Failed to bind/);
assert.match(error, /port listener: node pid 12345/);

console.log("ICPDB local network checks OK");

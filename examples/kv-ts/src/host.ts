#!/usr/bin/env node
// The KV host executable (TypeScript target): three lines of wiring, no
// scenario branches, no test awareness.

import { runExecSpecHost } from "@execspec/ts-generator";
import { KVExecSpecDispatcher } from "./KVGenerated/ExecSpecDispatcher.js";
import { KVStore } from "./KVStore.js";

await runExecSpecHost(new KVExecSpecDispatcher(new KVStore()));

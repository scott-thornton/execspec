#!/usr/bin/env node
import { runExecSpecHost } from "@execspec/ts-generator";
import { BillingExecSpecDispatcher } from "./BillingGenerated/ExecSpecDispatcher.js";
import { BillingEngine } from "./BillingEngine.js";

await runExecSpecHost(new BillingExecSpecDispatcher(new BillingEngine()));

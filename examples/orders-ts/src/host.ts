#!/usr/bin/env node
import { runExecSpecHost } from "@execspec/ts-generator";
import { OrdersExecSpecDispatcher } from "./OrdersGenerated/ExecSpecDispatcher.js";
import { OrderStore } from "./OrderStore.js";

await runExecSpecHost(new OrdersExecSpecDispatcher(new OrderStore()));

#!/usr/bin/env node
import { runExecSpecHost } from "@execspec/ts-generator";
import { MENUExecSpecDispatcher } from "./MenuGenerated/ExecSpecDispatcher.js";
import { MenuPricer } from "./MenuPricer.js";

await runExecSpecHost(new MENUExecSpecDispatcher(new MenuPricer()));

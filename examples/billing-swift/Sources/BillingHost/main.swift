import ExecSpecRuntime
import BillingGenerated
import BillingImplementation

let engine = BillingEngine()
let dispatcher = BillingExecSpecDispatcher(implementation: engine)
await runExecSpecHost(dispatcher: dispatcher)

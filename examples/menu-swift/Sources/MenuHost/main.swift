import ExecSpecRuntime
import MenuGenerated
import MenuImplementation

let pricer = MenuPricer()
let dispatcher = MENUExecSpecDispatcher(implementation: pricer)
await runExecSpecHost(dispatcher: dispatcher)

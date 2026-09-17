// The orders host executable: wiring only.

import ExecSpecRuntime
import OrdersGenerated
import OrdersImplementation

let store = OrderStore()
let dispatcher = OrdersExecSpecDispatcher(implementation: store)
await runExecSpecHost(dispatcher: dispatcher)

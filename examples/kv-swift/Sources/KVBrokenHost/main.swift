// The broken KV host: identical wiring, incorrect implementation.

import ExecSpecRuntime
import KVGenerated
import KVBrokenImplementation

let store = KVBrokenStore()
let dispatcher = KVExecSpecDispatcher(implementation: store)
await runExecSpecHost(dispatcher: dispatcher)

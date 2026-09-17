// The KV host executable (plan Task 41): no scenario branches, no
// environment-variable shortcuts, no test-case awareness.

import ExecSpecRuntime
import KVGenerated
import KVImplementation

let store = KVStore()
let dispatcher = KVExecSpecDispatcher(implementation: store)
await runExecSpecHost(dispatcher: dispatcher)

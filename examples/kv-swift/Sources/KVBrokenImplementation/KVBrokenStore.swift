// Deliberately incorrect implementation (plan Task 43): first write
// wins, so `kv.put.overwrite` fails while everything else passes. This
// fixture exists to prove the suite can fail.

import ExecSpecRuntime
import KVGenerated

public actor KVBrokenStore: KVSpecificationImplementation {
    private var values: [String: String] = [:]

    public init() {}

    public func kvPut(_ input: PutRequest) async throws -> ExecSpecUnit {
        if values[input.key] == nil {
            values[input.key] = input.value
        }
        return ExecSpecUnit()
    }

    public func kvGet(_ input: GetRequest) async throws -> GetResult {
        guard let value = values[input.key] else {
            return .missing
        }
        return .found(value)
    }

    public func kvDelete(_ input: DeleteRequest) async throws -> ExecSpecUnit {
        values.removeValue(forKey: input.key)
        return ExecSpecUnit()
    }

    public func kvList(_ input: ExecSpecUnit) async throws -> KeyList {
        let keys = values.keys.sorted { left, right in
            left.utf8.lexicographicallyPrecedes(right.utf8)
        }
        return KeyList(keys: keys)
    }

    public func kvEchoRevision(_ input: RevisionRequest) async throws -> RevisionResult {
        RevisionResult(revision: input.revision)
    }
}

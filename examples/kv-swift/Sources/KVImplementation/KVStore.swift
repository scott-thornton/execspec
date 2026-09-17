// The handwritten KV implementation (plan Task 40). The actor is a
// target-specific choice: the specification knows nothing about
// concurrency, and the generated contract only demands the semantics.

import ExecSpecRuntime
import KVGenerated

public actor KVStore: KVSpecificationImplementation {
    private var values: [String: String] = [:]

    public init() {}

    public func kvPut(_ input: PutRequest) async throws -> ExecSpecUnit {
        values[input.key] = input.value
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
        // Ascending Unicode scalar lexical order — UTF-8 byte order, so
        // dictionary iteration order can never leak through.
        let keys = values.keys.sorted { left, right in
            left.utf8.lexicographicallyPrecedes(right.utf8)
        }
        return KeyList(keys: keys)
    }

    public func kvEchoRevision(_ input: RevisionRequest) async throws -> RevisionResult {
        RevisionResult(revision: input.revision)
    }
}

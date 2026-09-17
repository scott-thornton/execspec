import Testing
import ExecSpecRuntime
@testable import KVGenerated
@testable import KVImplementation

@Suite struct KVStoreTests {
    @Test func putGetOverwriteDelete() async throws {
        let store = KVStore()
        _ = try await store.kvPut(PutRequest(key: "a", value: "one"))
        if case .found(let value) = try await store.kvGet(GetRequest(key: "a")) {
            #expect(value == "one")
        } else {
            Issue.record("expected found after put")
        }
        _ = try await store.kvPut(PutRequest(key: "a", value: "second"))
        if case .found(let value) = try await store.kvGet(GetRequest(key: "a")) {
            #expect(value == "second")
        } else {
            Issue.record("expected found after overwrite")
        }
        _ = try await store.kvDelete(DeleteRequest(key: "a"))
        if case .missing = try await store.kvGet(GetRequest(key: "a")) {
        } else {
            Issue.record("expected missing after delete")
        }
        // Deleting a missing key is a successful no-op.
        _ = try await store.kvDelete(DeleteRequest(key: "b"))
    }

    @Test func listIsSortedByUnicodeScalarOrder() async throws {
        let store = KVStore()
        for key in ["m", "a", "z", "é", "A"] {
            _ = try await store.kvPut(PutRequest(key: key, value: "v"))
        }
        let list = try await store.kvList(ExecSpecUnit())
        #expect(list.keys == ["A", "a", "m", "z", "é"])
    }

    @Test func echoRevisionPreservesFullWidthInt64() async throws {
        let store = KVStore()
        let max = try await store.kvEchoRevision(RevisionRequest(revision: Int64.max))
        #expect(max.revision == Int64.max)
        let min = try await store.kvEchoRevision(RevisionRequest(revision: Int64.min))
        #expect(min.revision == Int64.min)
    }
}

@Suite struct GeneratedCodecTests {
    @Test func int64WireEncodingIsTaggedString() throws {
        let encoded = try encodeValue_int64(Int64.max)
        #expect(encoded == .object(["$i64": .string("9223372036854775807")]))
        let decoded = try decodeValue_int64(.object(["$i64": .string("9223372036854775807")]))
        #expect(decoded == Int64.max)

        #expect(throws: ExecSpecHostFailure.self) {
            _ = try decodeValue_int64(.object(["$i64": .string("9223372036854775808")]))
        }
        #expect(throws: ExecSpecHostFailure.self) {
            _ = try decodeValue_int64(.object(["$i64": .string("-0")]))
        }
    }

    @Test func structCodecRoundTripAndRejections() throws {
        let request = PutRequest(key: "a", value: "one")
        let encoded = try encodePutRequest(request)
        #expect(encoded == .object(["key": .string("a"), "value": .string("one")]))
        let decoded = try decodePutRequest(encoded)
        #expect(decoded.key == "a")
        #expect(decoded.value == "one")

        #expect(throws: ExecSpecHostFailure.self) {
            _ = try decodePutRequest(.object(["key": .string("a")]))
        }
        #expect(throws: ExecSpecHostFailure.self) {
            _ = try decodePutRequest(.object(["key": .string("a"), "value": .string("v"), "extra": .null]))
        }
        #expect(throws: ExecSpecHostFailure.self) {
            _ = try decodePutRequest(.object(["key": .null, "value": .string("v")]))
        }
    }

    @Test func unionCodecRules() throws {
        #expect(try encodeGetResult(.missing) == .object(["$case": .string("missing")]))
        #expect(
            try encodeGetResult(.found("one"))
                == .object(["$case": .string("found"), "value": .string("one")])
        )
        #expect(throws: ExecSpecHostFailure.self) {
            _ = try decodeGetResult(.object(["$case": .string("found")]))
        }
        #expect(throws: ExecSpecHostFailure.self) {
            _ = try decodeGetResult(.object(["$case": .string("missing"), "value": .null]))
        }
        #expect(throws: ExecSpecHostFailure.self) {
            _ = try decodeGetResult(.object(["$case": .string("nope")]))
        }
    }
}

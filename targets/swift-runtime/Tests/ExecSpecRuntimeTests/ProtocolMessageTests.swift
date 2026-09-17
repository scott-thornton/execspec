import Testing
@testable import ExecSpecRuntime

@Suite struct ProtocolMessageTests {
    @Test func helloRoundTrip() throws {
        let hello = ProtocolHello(protocolVersion: 1, specificationDigest: "ab")
        let encoded = encodeHello(hello)
        #expect(try decodeHello(encoded) == hello)
    }

    @Test func strictDecodingRejectsMissingExtraAndWrongTypes() {
        // missing field
        #expect(throws: ProtocolMessageError.self) {
            _ = try decodeHello(.object(["kind": .string("hello"), "protocolVersion": .number("1")]))
        }
        // additional field
        #expect(throws: ProtocolMessageError.self) {
            _ = try decodeHello(.object([
                "kind": .string("hello"),
                "protocolVersion": .number("1"),
                "specificationDigest": .string("ab"),
                "extra": .null,
            ]))
        }
        // wrong type
        #expect(throws: ProtocolMessageError.self) {
            _ = try decodeHello(.object([
                "kind": .string("hello"),
                "protocolVersion": .string("1"),
                "specificationDigest": .string("ab"),
            ]))
        }
        // wrong kind
        #expect(throws: ProtocolMessageError.self) {
            _ = try decodeHello(.object([
                "kind": .string("request"),
                "protocolVersion": .number("1"),
                "specificationDigest": .string("ab"),
            ]))
        }
        // not an object
        #expect(throws: ProtocolMessageError.self) {
            _ = try decodeHello(.array([]))
        }
    }

    @Test func requestResponseFailureRoundTrip() throws {
        let request = ProtocolRequest(id: "1", operation: "kv.get", input: .object(["key": .string("a")]))
        #expect(try decodeRequest(encodeRequest(request)) == request)

        let response = ProtocolResponse(id: "1", output: .object(["$case": .string("missing")]))
        #expect(try decodeResponse(encodeResponse(response)) == response)

        let failure = ProtocolFailure(id: "1", category: "implementationException", message: "boom")
        #expect(try decodeFailure(encodeFailure(failure)) == failure)
    }
}

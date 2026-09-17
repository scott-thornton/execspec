import Foundation
import Testing
@testable import ExecSpecRuntime

/// Records every dispatch; used to prove handshake failures never dispatch.
actor RecordingDispatcher: ExecSpecDispatcher {
    nonisolated let specificationDigest: String = "digest-0000"
    private var operations: [String] = []
    private var behavior: @Sendable (String, JSONValue) throws -> JSONValue

    init(behavior: @escaping @Sendable (String, JSONValue) throws -> JSONValue) {
        self.behavior = behavior
    }

    func dispatchedOperations() -> [String] {
        operations
    }

    func dispatch(operation: String, input: JSONValue) async throws -> JSONValue {
        operations.append(operation)
        return try behavior(operation, input)
    }
}

func driveHost(
    _ dispatcher: some ExecSpecDispatcher,
    lines: [String]
) async throws -> (exitCode: Int32, output: [JSONValue]) {
    let inputPipe = Pipe()
    let outputPipe = Pipe()
    for line in lines {
        try inputPipe.fileHandleForWriting.write(contentsOf: Data((line + "\n").utf8))
    }
    try inputPipe.fileHandleForWriting.close()
    let code = await HostLoop.run(
        dispatcher: dispatcher,
        input: inputPipe.fileHandleForReading,
        output: outputPipe.fileHandleForWriting
    )
    try outputPipe.fileHandleForWriting.close()
    var connection = NDJSONConnection(
        input: outputPipe.fileHandleForReading,
        output: FileHandle.nullDevice
    )
    var messages: [JSONValue] = []
    while let message = try? connection.read() {
        messages.append(message)
    }
    return (code, messages)
}

func helloLine(digest: String = "digest-0000", version: Int = 1) -> String {
    serializeJSON(.object([
        "kind": .string("hello"),
        "protocolVersion": .number(String(version)),
        "specificationDigest": .string(digest),
    ]))
}

func requestLine(id: String, operation: String, input: JSONValue = .object([:])) -> String {
    serializeJSON(.object([
        "kind": .string("request"),
        "id": .string(id),
        "operation": .string(operation),
        "input": input,
    ]))
}

@Suite struct HostTests {
    @Test func happyPathHandshakesAndDispatchesSequentially() async throws {
        let dispatcher = await RecordingDispatcher { operation, input in
            #expect(operation == "kv.echo")
            return input
        }
        let (code, messages) = try await driveHost(dispatcher, lines: [
            helloLine(),
            requestLine(id: "1", operation: "kv.echo", input: .object(["key": .string("a")])),
            requestLine(id: "2", operation: "kv.echo", input: .object(["key": .string("b")])),
        ])
        #expect(code == 0)
        #expect(messages.count == 3)
        guard case .object(let ack)? = messages.first else {
            Issue.record("expected helloAck")
            return
        }
        #expect(ack["target"] == .string("swift"))
        guard case .object(let first)? = messages.dropFirst().first else {
            Issue.record("expected response")
            return
        }
        #expect(first["id"] == .string("1"))
        #expect(first["output"] == .object(["key": .string("a")]))
        let dispatched = await dispatcher.dispatchedOperations()
        #expect(dispatched == ["kv.echo", "kv.echo"])
    }

    @Test func digestMismatchExitsBeforeAnyDispatch() async throws {
        let dispatcher = await RecordingDispatcher { _, input in input }
        let (code, messages) = try await driveHost(dispatcher, lines: [
            helloLine(digest: "stale-digest"),
            requestLine(id: "1", operation: "kv.echo"),
        ])
        #expect(code == 1)
        #expect(messages.isEmpty)
        let dispatched = await dispatcher.dispatchedOperations()
        #expect(dispatched.isEmpty)
    }

    @Test func protocolVersionMismatchExitsBeforeAnyDispatch() async throws {
        let dispatcher = await RecordingDispatcher { _, input in input }
        let (code, messages) = try await driveHost(dispatcher, lines: [
            helloLine(version: 2),
        ])
        #expect(code == 1)
        #expect(messages.isEmpty)
        let dispatched = await dispatcher.dispatchedOperations()
        #expect(dispatched.isEmpty)
    }

    @Test func nonHelloFirstMessageRejected() async throws {
        let dispatcher = await RecordingDispatcher { _, input in input }
        let (code, messages) = try await driveHost(dispatcher, lines: [
            requestLine(id: "1", operation: "kv.echo"),
        ])
        #expect(code == 1)
        #expect(messages.isEmpty)
        let dispatched = await dispatcher.dispatchedOperations()
        #expect(dispatched.isEmpty)
    }

    @Test func eofBeforeHelloExitsNonzero() async throws {
        let dispatcher = await RecordingDispatcher { _, input in input }
        let (code, messages) = try await driveHost(dispatcher, lines: [])
        #expect(code == 1)
        #expect(messages.isEmpty)
    }

    @Test func malformedRequestLineReportsProtocolViolationAndContinues() async throws {
        let dispatcher = await RecordingDispatcher { _, input in input }
        let (code, messages) = try await driveHost(dispatcher, lines: [
            helloLine(),
            #"{not json}"#,
            requestLine(id: "1", operation: "kv.echo", input: .object(["ok": .bool(true)])),
        ])
        #expect(code == 0)
        #expect(messages.count == 3) // helloAck + failure + response
        guard case .object(let failure)? = messages.first(where: { message in
            if case .object(let object) = message, object["kind"] == .string("failure") {
                return true
            }
            return false
        }) else {
            Issue.record("expected a failure message")
            return
        }
        #expect(failure["category"] == .string("protocolViolation"))
        guard case .object(let response)? = messages.last, response["kind"] == .string("response") else {
            Issue.record("expected a response after the failure")
            return
        }
        #expect(response["id"] == .string("1"))
    }

    @Test func unknownOperationMapsToInvalidRequest() async throws {
        let dispatcher = await RecordingDispatcher { _, _ in
            throw ExecSpecHostFailure.invalidRequest("unknown operation: kv.nope")
        }
        let (code, messages) = try await driveHost(dispatcher, lines: [
            helloLine(),
            requestLine(id: "1", operation: "kv.nope"),
        ])
        #expect(code == 0)
        guard case .object(let failure)? = messages.last else {
            Issue.record("expected failure")
            return
        }
        #expect(failure["category"] == .string("invalidRequest"))
        #expect(failure["id"] == .string("1"))
    }

    @Test func implementationThrowMapsToImplementationException() async throws {
        struct Boom: Error {}
        let dispatcher = await RecordingDispatcher { _, _ in
            throw Boom()
        }
        let (code, messages) = try await driveHost(dispatcher, lines: [
            helloLine(),
            requestLine(id: "7", operation: "kv.echo"),
        ])
        #expect(code == 0)
        guard case .object(let failure)? = messages.last else {
            Issue.record("expected failure")
            return
        }
        #expect(failure["category"] == .string("implementationException"))
        #expect(failure["id"] == .string("7"))
    }

    @Test func partialLineAtEOFIsAFailureThenNonzeroExit() async throws {
        let dispatcher = await RecordingDispatcher { _, input in input }
        let inputPipe = Pipe()
        let outputPipe = Pipe()
        try inputPipe.fileHandleForWriting.write(contentsOf: Data((helloLine() + "\n" + "{\"kind\"").utf8))
        try inputPipe.fileHandleForWriting.close()
        let partialCode = await HostLoop.run(
            dispatcher: dispatcher,
            input: inputPipe.fileHandleForReading,
            output: outputPipe.fileHandleForWriting
        )
        try outputPipe.fileHandleForWriting.close()
        #expect(partialCode == 1)
        let dispatched = await dispatcher.dispatchedOperations()
        #expect(dispatched.isEmpty)
    }
}

// ExecSpecRuntime: host loop (docs/protocol-v1.md §2-§5).
//
// Handshake first; protocol version or digest mismatch exits nonzero
// before any operation is dispatched. Requests are sequential in v1.
// Generated dispatchers turn unknown operations and codec failures into
// ExecSpecHostFailure; implementation throws become
// implementationException failures.

import Foundation

public enum ExecSpecHostFailureCategory: String, Sendable {
    case invalidRequest
    case protocolViolation
}

/// A failure the host reports as a `failure` message rather than an
/// implementation exception.
public struct ExecSpecHostFailure: Error, Sendable {
    public let category: ExecSpecHostFailureCategory
    public let message: String

    public static func invalidRequest(_ message: String) -> ExecSpecHostFailure {
        ExecSpecHostFailure(category: .invalidRequest, message: message)
    }

    public static func protocolViolation(_ message: String) -> ExecSpecHostFailure {
        ExecSpecHostFailure(category: .protocolViolation, message: message)
    }
}

/// What generated dispatch conforms to.
public protocol ExecSpecDispatcher: Sendable {
    var specificationDigest: String { get }
    func dispatch(operation: String, input: JSONValue) async throws -> JSONValue
}

enum ExecSpecStderr {
    static func write(_ text: String) {
        var bytes = Array((text + "\n").utf8)
        bytes.withUnsafeMutableBytes { pointer in
            _ = pointer.baseAddress.map { base in
                Darwin.write(FileHandle.standardError.fileDescriptor, base, pointer.count)
            }
        }
    }
}

func describeError(_ error: Error) -> String {
    if let jsonError = error as? JSONError {
        switch jsonError {
        case .syntax(let detail): return "invalid JSON: \(detail)"
        case .duplicateKey(let key): return "duplicate JSON key: \(key)"
        case .invalidUTF8: return "invalid UTF-8"
        }
    }
    if let ndjsonError = error as? NDJSONError {
        switch ndjsonError {
        case .lineTooLong(let bytes): return "line exceeds 16 MiB (\(bytes) bytes)"
        case .invalidUTF8: return "invalid UTF-8"
        case .partialLineAtEOF: return "partial NDJSON message at EOF"
        case .readFailed(let detail): return "read failed: \(detail)"
        case .writeFailed(let detail): return "write failed: \(detail)"
        }
    }
    if let messageError = error as? ProtocolMessageError {
        if case .malformed(let detail) = messageError {
            return "malformed protocol message: \(detail)"
        }
    }
    return String(describing: error)
}

/// The testable core of the host process. Returns the process exit code.
enum HostLoop {
    static func run(
        dispatcher: some ExecSpecDispatcher,
        input: FileHandle,
        output: FileHandle
    ) async -> Int32 {
        var connection = NDJSONConnection(input: input, output: output)

        // --- Handshake ---
        do {
            guard let rawHello = try connection.read() else {
                ExecSpecStderr.write("execspec host: EOF before hello")
                return 1
            }
            let hello = try decodeHello(rawHello)
            if hello.protocolVersion != execSpecProtocolVersion {
                ExecSpecStderr.write(
                    "execspec host: protocol version mismatch (harness \(hello.protocolVersion), host \(execSpecProtocolVersion))"
                )
                return 1
            }
            if hello.specificationDigest != dispatcher.specificationDigest {
                ExecSpecStderr.write("execspec host: specification digest mismatch")
                return 1
            }
            try connection.write(encodeHelloAck(ProtocolHelloAck(
                protocolVersion: execSpecProtocolVersion,
                specificationDigest: dispatcher.specificationDigest,
                target: "swift"
            )))
        } catch {
            ExecSpecStderr.write("execspec host: handshake failure: \(describeError(error))")
            return 1
        }

        // --- Sequential request loop ---
        while true {
            let line: String?
            do {
                line = try connection.readLine()
            } catch {
                ExecSpecStderr.write("execspec host: read failure: \(describeError(error))")
                try? connection.write(encodeFailure(ProtocolFailure(
                    id: "",
                    category: ExecSpecHostFailureCategory.protocolViolation.rawValue,
                    message: describeError(error)
                )))
                return 1
            }
            guard let line else {
                return 0 // clean EOF
            }
            let raw: JSONValue
            do {
                raw = try JSONParser.parse(line)
            } catch {
                // A malformed message kills the message, not the stream.
                try? connection.write(encodeFailure(ProtocolFailure(
                    id: "",
                    category: ExecSpecHostFailureCategory.protocolViolation.rawValue,
                    message: describeError(error)
                )))
                continue
            }
            let request: ProtocolRequest
            do {
                request = try decodeRequest(raw)
            } catch {
                try? connection.write(encodeFailure(ProtocolFailure(
                    id: "",
                    category: ExecSpecHostFailureCategory.protocolViolation.rawValue,
                    message: describeError(error)
                )))
                continue
            }
            do {
                let outputValue = try await dispatcher.dispatch(operation: request.operation, input: request.input)
                do {
                    try connection.write(encodeResponse(ProtocolResponse(id: request.id, output: outputValue)))
                } catch {
                    ExecSpecStderr.write("execspec host: write failure: \(describeError(error))")
                    return 1
                }
            } catch let hostFailure as ExecSpecHostFailure {
                try? connection.write(encodeFailure(ProtocolFailure(
                    id: request.id,
                    category: hostFailure.category.rawValue,
                    message: hostFailure.message
                )))
            } catch {
                try? connection.write(encodeFailure(ProtocolFailure(
                    id: request.id,
                    category: "implementationException",
                    message: String(describing: error)
                )))
            }
        }
    }
}

/// Runtime entry point for generated hosts. Never returns.
public func runExecSpecHost(dispatcher: some ExecSpecDispatcher) async -> Never {
    let code = await HostLoop.run(
        dispatcher: dispatcher,
        input: FileHandle.standardInput,
        output: FileHandle.standardOutput
    )
    exit(code)
}

// ExecSpecRuntime: NDJSON transport (protocol v1).
//
// One UTF-8 JSON message per line, 16 MiB line limit, invalid UTF-8 and
// partial final lines are protocol failures, stdout is protocol-only.

import Foundation

public enum NDJSONError: Error, Sendable, Equatable {
    case lineTooLong(Int)
    case invalidUTF8
    case partialLineAtEOF
    case writeFailed(String)
}

public let execSpecMaxLineBytes = 16 * 1024 * 1024

/// Byte-level line assembler, testable without file handles. Splits a
/// chunk stream on LF, enforces the line limit, and strictly decodes
/// UTF-8 per line.
public struct LineAssembler {
    private let maxLineBytes: Int
    private var buffer: [UInt8] = []

    public init(maxLineBytes: Int = execSpecMaxLineBytes) {
        self.maxLineBytes = maxLineBytes
    }

    /// Appends a chunk and returns every completed line it produced.
    public mutating func append(_ chunk: [UInt8]) throws -> [String] {
        var lines: [String] = []
        var start = 0
        for (offset, byte) in chunk.enumerated() where byte == 0x0A {
            let lineLength = buffer.count + (offset - start)
            if lineLength > maxLineBytes {
                throw NDJSONError.lineTooLong(lineLength)
            }
            buffer.append(contentsOf: chunk[start..<offset])
            guard let line = String(bytes: buffer, encoding: .utf8) else {
                throw NDJSONError.invalidUTF8
            }
            buffer.removeAll(keepingCapacity: true)
            lines.append(line)
            start = offset + 1
        }
        buffer.append(contentsOf: chunk[start...])
        if buffer.count > maxLineBytes {
            throw NDJSONError.lineTooLong(buffer.count)
        }
        return lines
    }

    /// Finishes the stream: a non-empty remainder without a trailing LF
    /// is a protocol failure.
    public mutating func finish() throws {
        if !buffer.isEmpty {
            throw NDJSONError.partialLineAtEOF
        }
    }
}

/// A connection over a pair of file handles: blocking reads, one
/// response flushed per write.
public struct NDJSONConnection {
    private let input: FileHandle
    private let output: FileHandle
    private var assembler = LineAssembler()
    private var pending: [String] = []

    public init(input: FileHandle, output: FileHandle) {
        self.input = input
        self.output = output
    }

    /// Reads the next raw line (transport errors only); nil at clean end
    /// of stream. JSON parsing is deliberately left to the caller so a
    /// malformed message can be reported without killing the stream.
    public mutating func readLine() throws -> String? {
        while true {
            if !pending.isEmpty {
                return pending.removeFirst()
            }
            guard let chunk = try readChunk() else {
                try assembler.finish()
                return nil
            }
            pending = try assembler.append(chunk)
        }
    }

    /// Reads the next message; nil at clean end of stream.
    public mutating func read() throws -> JSONValue? {
        while true {
            guard let line = try readLine() else {
                return nil
            }
            return try JSONParser.parse(line)
        }
    }

    private mutating func readChunk() throws -> [UInt8]? {
        guard let data = try input.read(upToCount: 65536), !data.isEmpty else {
            return nil
        }
        return [UInt8](data)
    }

    /// Writes exactly one JSON object plus LF, then flushes.
    public mutating func write(_ value: JSONValue) throws {
        var text = serializeJSON(value)
        text += "\n"
        do {
            try output.write(contentsOf: Data(text.utf8))
        } catch {
            throw NDJSONError.writeFailed(String(describing: error))
        }
    }
}

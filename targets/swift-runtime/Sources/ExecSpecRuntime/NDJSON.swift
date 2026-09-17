// ExecSpecRuntime: NDJSON transport (protocol v1).
//
// One UTF-8 JSON message per line, 16 MiB line limit, invalid UTF-8 and
// partial final lines are protocol failures, stdout is protocol-only.
//
// ADR (docs/protocol-v1.md): I/O uses POSIX read/write on the file
// descriptors. Foundation's NSFileHandle read path stalls on the
// socketpair stdio that some harness runtimes (Node ≥ 25) use for child
// processes; POSIX calls behave identically on pipes and sockets.

import Foundation

public enum NDJSONError: Error, Sendable, Equatable {
    case lineTooLong(Int)
    case invalidUTF8
    case partialLineAtEOF
    case readFailed(String)
    case writeFailed(String)
}

public let execSpecMaxLineBytes = 16 * 1024 * 1024

func posixReadChunk(fd: Int32, max: Int) throws -> [UInt8]? {
    var buffer = [UInt8](repeating: 0, count: max)
    let bytesRead = buffer.withUnsafeMutableBytes { pointer -> Int in
        guard let base = pointer.baseAddress else { return 0 }
        return Darwin.read(fd, base, max)
    }
    if bytesRead < 0 {
        throw NDJSONError.readFailed(String(cString: Darwin.strerror(Darwin.errno)))
    }
    if bytesRead == 0 {
        return nil
    }
    return Array(buffer[0..<bytesRead])
}

func posixWriteChunk(fd: Int32, _ bytes: [UInt8]) throws {
    var offset = 0
    while offset < bytes.count {
        let written = bytes.withUnsafeBytes { pointer -> Int in
            guard let base = pointer.baseAddress else { return 0 }
            return Darwin.write(fd, base.advanced(by: offset), bytes.count - offset)
        }
        if written <= 0 {
            throw NDJSONError.writeFailed(String(cString: Darwin.strerror(Darwin.errno)))
        }
        offset += written
    }
}

/// Byte-level line assembler, testable without descriptors. Splits a
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

/// A connection over a pair of file descriptors: blocking reads, one
/// response flushed per write.
public struct NDJSONConnection {
    private let inputFD: Int32
    private let outputFD: Int32
    private var assembler = LineAssembler()
    private var pending: [String] = []

    public init(input: FileHandle, output: FileHandle) {
        self.inputFD = input.fileDescriptor
        self.outputFD = output.fileDescriptor
    }

    /// Reads the next raw line (transport errors only); nil at clean end
    /// of stream. JSON parsing is deliberately left to the caller so a
    /// malformed message can be reported without killing the stream.
    public mutating func readLine() throws -> String? {
        while true {
            if !pending.isEmpty {
                return pending.removeFirst()
            }
            guard let chunk = try posixReadChunk(fd: inputFD, max: 65536) else {
                try assembler.finish()
                return nil
            }
            pending = try assembler.append(chunk)
        }
    }

    /// Reads the next message; nil at clean end of stream.
    public mutating func read() throws -> JSONValue? {
        guard let line = try readLine() else {
            return nil
        }
        return try JSONParser.parse(line)
    }

    /// Writes exactly one JSON object plus LF, then flushes.
    public mutating func write(_ value: JSONValue) throws {
        var bytes = Array(serializeJSON(value).utf8)
        bytes.append(0x0A)
        try posixWriteChunk(fd: outputFD, bytes)
    }
}

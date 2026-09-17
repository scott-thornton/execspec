import Foundation
import Testing
@testable import ExecSpecRuntime

@Suite struct LineAssemblerTests {
    @Test func splitsChunksAcrossMessagesAndUTF8Boundaries() throws {
        var assembler = LineAssembler()
        let emoji = [UInt8]("\u{1F600}".utf8)
        var first = Array("{\"a\":\"".utf8)
        first.append(contentsOf: emoji[...2])
        #expect(try assembler.append(first).isEmpty)
        var second = Array(emoji[3...])
        second.append(contentsOf: Array("\"}\n".utf8))
        second.append(contentsOf: Array("{\"b\":2}".utf8))
        second.append(0x0A)
        let lines = try assembler.append(second)
        #expect(lines == ["{\"a\":\"\u{1F600}\"}", "{\"b\":2}"])
        try assembler.finish()
    }

    @Test func rejectsPartialFinalLine() {
        var assembler = LineAssembler()
        #expect(throws: NDJSONError.partialLineAtEOF) {
            _ = try assembler.append(Array(#"{"a":1}"#.utf8))
            try assembler.finish()
        }
    }

    @Test func trailingNewlineYieldsCleanFinish() throws {
        var assembler = LineAssembler()
        let lines = try assembler.append(Array("{\"a\":1}\n".utf8))
        #expect(lines == ["{\"a\":1}"])
        try assembler.finish()
    }

    @Test func rejectsOversizedLines() {
        var assembler = LineAssembler(maxLineBytes: 16)
        #expect(throws: NDJSONError.lineTooLong(17)) {
            _ = try assembler.append(Array(repeating: UInt8(ascii: "a"), count: 17))
        }
    }

    @Test func rejectsInvalidUTF8() {
        var assembler = LineAssembler()
        #expect(throws: NDJSONError.invalidUTF8) {
            _ = try assembler.append([0xFF, 0xFE, 0x0A])
        }
    }
}

@Suite struct NDJSONConnectionTests {
    @Test func readsMessagesAcrossChunkBoundariesAndWritesOneLinePerMessage() throws {
        let inputPipe = Pipe()
        let outputPipe = Pipe()
        var connection = NDJSONConnection(
            input: inputPipe.fileHandleForReading,
            output: outputPipe.fileHandleForWriting
        )

        let payload = serializeJSON(JSONValue.object(["kind": .string("hello"), "protocolVersion": .number("1")]))
        var bytes = Array(payload.utf8)
        bytes.append(0x0A)
        // Write in two small chunks to force reassembly.
        try inputPipe.fileHandleForWriting.write(contentsOf: Data(bytes[..<5]))
        try inputPipe.fileHandleForWriting.write(contentsOf: Data(bytes[5...]))
        try inputPipe.fileHandleForWriting.close()

        let message = try connection.read()
        #expect(message == JSONValue.object(["kind": .string("hello"), "protocolVersion": .number("1")]))
        #expect(try connection.read() == nil)

        try connection.write(JSONValue.object(["ok": .bool(true)]))
        try outputPipe.fileHandleForWriting.close()
        let written = outputPipe.fileHandleForReading.readDataToEndOfFile()
        #expect(String(decoding: written, as: UTF8.self) == "{\"ok\":true}\n")
    }

    // The >16 MiB wire-line path is covered byte-level in
    // LineAssemblerTests.rejectsOversizedLines (the same append() code the
    // connection calls); a full 16 MiB pipe fixture would deadlock on the
    // 64 KiB pipe buffer during synchronous test setup. The harness-side
    // TypeScript suite covers the full-size line end to end.
}

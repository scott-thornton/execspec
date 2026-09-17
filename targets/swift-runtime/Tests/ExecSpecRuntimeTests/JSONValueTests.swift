import Testing
@testable import ExecSpecRuntime

@Suite struct JSONValueTests {
    @Test func parsesLiteralsAndNesting() throws {
        let value = try JSONParser.parse(#"{"a": [1, true, null], "b": "x"}"#)
        guard case .object(let object) = value else {
            Issue.record("expected object")
            return
        }
        #expect(object.count == 2)
        guard case .array(let array)? = object["a"] else {
            Issue.record("expected array")
            return
        }
        #expect(array.count == 3)
        #expect(array[0] == .number("1"))
        #expect(array[1] == .bool(true))
        #expect(array[2] == .null)
    }

    @Test func numberSpellingsRoundTripExactly() throws {
        for spelling in ["0", "-0", "1e3", "0.10", "-42", "9223372036854775807", "1E+22"] {
            let value = try JSONParser.parse(spelling)
            #expect(value == .number(spelling))
            #expect(serializeJSON(value) == spelling)
        }
    }

    @Test func duplicateKeysRejected() {
        #expect(throws: JSONError.self) {
            _ = try JSONParser.parse(#"{"a":1,"a":2}"#)
        }
    }

    @Test func syntaxErrorsRejected() {
        for text in ["", "{", #"{"" no colon}"#, "[1,]", "tru", #""unterminated"#, "01", "1.", "-", #"{\"a\":1,}"#] {
            #expect(throws: JSONError.self) {
                _ = try JSONParser.parse(text)
            }
        }
    }

    @Test func stringEscapesAndUnicode() throws {
        let text = try JSONParser.parse(#""é 😀 \" \\ \n \u0001""#)
        guard case .string(let parsed) = text else {
            Issue.record("expected string")
            return
        }
        #expect(parsed == "é 😀 \" \\ \n \u{01}")
        // Non-ASCII is emitted raw; controls escaped.
        #expect(serializeJSON(text) == "\"é 😀 \\\" \\\\ \\n \\u0001\"")
    }

    @Test func surrogatePairsAndLoneSurrogates() throws {
        #expect(try JSONParser.parse("\"\u{1F600}\"") == .string("\u{1F600}"))
        #expect(throws: JSONError.self) {
            _ = try JSONParser.parse("\"\\ud800\"")
        }
        #expect(throws: JSONError.self) {
            _ = try JSONParser.parse("\"\\udc00\"")
        }
        #expect(throws: JSONError.self) {
            _ = try JSONParser.parse("\"\\ud800\\ud800\"")
        }
    }

    @Test func serializerSortsKeysByScalarOrderAndSkipsWhitespace() {
        let value = JSONValue.object([
            "é": .number("1"),
            "z": .number("2"),
            "a": .array([]),
        ])
        #expect(serializeJSON(value) == #"{"a":[],"z":2,"é":1}"#)
    }

    @Test func canonicalInt64Spellings() {
        #expect(ExecSpecWire.isCanonicalInt64Spelling("0"))
        #expect(ExecSpecWire.isCanonicalInt64Spelling("-1"))
        #expect(ExecSpecWire.isCanonicalInt64Spelling("9223372036854775807"))
        #expect(ExecSpecWire.isCanonicalInt64Spelling("-9223372036854775808"))
        #expect(!ExecSpecWire.isCanonicalInt64Spelling("01"))
        #expect(!ExecSpecWire.isCanonicalInt64Spelling("+1"))
        #expect(!ExecSpecWire.isCanonicalInt64Spelling("-0"))
        #expect(!ExecSpecWire.isCanonicalInt64Spelling("1.0"))
        #expect(!ExecSpecWire.isCanonicalInt64Spelling(""))
        #expect(!ExecSpecWire.isCanonicalInt64Spelling("-"))
    }
}

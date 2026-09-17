// ExecSpecRuntime: JSON value model.
//
// ADR (recorded in docs/protocol-v1.md and docs/implementation-status.md):
// the plan suggested Foundation's JSON facilities, but JSONSerialization
// cannot preserve exact numeric spellings or reject duplicate object
// keys, both of which protocol v1 requires. This file therefore provides
// a strict hand-written parser/serializer. Foundation remains in use for
// process I/O (FileHandle, Data).

import Foundation

public enum JSONValue: Sendable, Equatable {
    case null
    case bool(Bool)
    case string(String)
    /// Exact decimal/exponent spelling as it appeared on the wire. The
    /// semantic int64 type never uses this case; it keeps generated
    /// codecs from silently losing numeric precision.
    case number(String)
    case array([JSONValue])
    case object([String: JSONValue])
}

public enum JSONError: Error, Sendable {
    case syntax(String)
    case duplicateKey(String)
    case invalidUTF8
}

public enum JSONParser {
    public static func parse(_ text: String) throws -> JSONValue {
        var parser = Parser(bytes: Array(text.utf8))
        parser.skipWhitespace()
        let value = try parser.parseValue()
        parser.skipWhitespace()
        guard parser.isAtEnd else {
            throw JSONError.syntax("trailing characters after JSON value")
        }
        return value
    }
}

private struct Parser {
    private let bytes: [UInt8]
    private var index: Int = 0

    init(bytes: [UInt8]) {
        self.bytes = bytes
    }

    var isAtEnd: Bool { index >= bytes.count }

    private var current: UInt8? {
        index < bytes.count ? bytes[index] : nil
    }

    mutating func skipWhitespace() {
        while let byte = current, byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D {
            index += 1
        }
    }

    mutating func parseValue() throws -> JSONValue {
        guard let byte = current else {
            throw JSONError.syntax("unexpected end of input")
        }
        switch byte {
        case UInt8(ascii: "{"): return try parseObject()
        case UInt8(ascii: "["): return try parseArray()
        case UInt8(ascii: "\""): return .string(try parseString())
        case UInt8(ascii: "t"): try expectLiteral("true"); return .bool(true)
        case UInt8(ascii: "f"): try expectLiteral("false"); return .bool(false)
        case UInt8(ascii: "n"): try expectLiteral("null"); return .null
        case UInt8(ascii: "-"), UInt8(ascii: "0")...UInt8(ascii: "9"):
            return .number(try parseNumber())
        default:
            throw JSONError.syntax("unexpected character")
        }
    }

    private mutating func expectLiteral(_ literal: String) throws {
        for scalar in literal.utf8 {
            guard current == scalar else {
                throw JSONError.syntax("invalid literal")
            }
            index += 1
        }
    }

    private mutating func parseObject() throws -> JSONValue {
        index += 1 // consume '{'
        var object: [String: JSONValue] = [:]
        skipWhitespace()
        if current == UInt8(ascii: "}") {
            index += 1
            return .object(object)
        }
        while true {
            skipWhitespace()
            guard current == UInt8(ascii: "\"") else {
                throw JSONError.syntax("expected object key")
            }
            let key = try parseString()
            skipWhitespace()
            guard current == UInt8(ascii: ":") else {
                throw JSONError.syntax("expected ':' in object")
            }
            index += 1
            skipWhitespace()
            let value = try parseValue()
            if object[key] != nil {
                throw JSONError.duplicateKey(key)
            }
            object[key] = value
            skipWhitespace()
            if current == UInt8(ascii: ",") {
                index += 1
                continue
            }
            if current == UInt8(ascii: "}") {
                index += 1
                return .object(object)
            }
            throw JSONError.syntax("expected ',' or '}' in object")
        }
    }

    private mutating func parseArray() throws -> JSONValue {
        index += 1 // consume '['
        var values: [JSONValue] = []
        skipWhitespace()
        if current == UInt8(ascii: "]") {
            index += 1
            return .array(values)
        }
        while true {
            skipWhitespace()
            let value = try parseValue()
            values.append(value)
            skipWhitespace()
            if current == UInt8(ascii: ",") {
                index += 1
                continue
            }
            if current == UInt8(ascii: "]") {
                index += 1
                return .array(values)
            }
            throw JSONError.syntax("expected ',' or ']' in array")
        }
    }

    private mutating func parseString() throws -> String {
        index += 1 // consume '"'
        var content: [UInt8] = []
        while true {
            guard let byte = current else {
                throw JSONError.syntax("unterminated string")
            }
            if byte == UInt8(ascii: "\"") {
                index += 1
                guard let text = String(bytes: content, encoding: .utf8) else {
                    throw JSONError.invalidUTF8
                }
                return text
            }
            if byte == UInt8(ascii: "\\") {
                index += 1
                try parseEscape(into: &content)
                continue
            }
            if byte < 0x20 {
                throw JSONError.syntax("raw control character in string")
            }
            content.append(byte)
            index += 1
        }
    }

    private mutating func parseEscape(into content: inout [UInt8]) throws {
        guard let escape = current else {
            throw JSONError.syntax("unterminated escape")
        }
        index += 1
        switch escape {
        case UInt8(ascii: "\""): content.append(UInt8(ascii: "\""))
        case UInt8(ascii: "\\"): content.append(UInt8(ascii: "\\"))
        case UInt8(ascii: "/"): content.append(UInt8(ascii: "/"))
        case UInt8(ascii: "b"): content.append(0x08)
        case UInt8(ascii: "f"): content.append(0x0C)
        case UInt8(ascii: "n"): content.append(0x0A)
        case UInt8(ascii: "r"): content.append(0x0D)
        case UInt8(ascii: "t"): content.append(0x09)
        case UInt8(ascii: "u"):
            var scalar = try parseHex4()
            if scalar >= 0xD800 && scalar <= 0xDBFF {
                // High surrogate: must pair with a low surrogate escape.
                guard current == UInt8(ascii: "\\") else {
                    throw JSONError.syntax("unpaired surrogate escape")
                }
                index += 1
                guard current == UInt8(ascii: "u") else {
                    throw JSONError.syntax("unpaired surrogate escape")
                }
                index += 1
                let low = try parseHex4()
                guard low >= 0xDC00 && low <= 0xDFFF else {
                    throw JSONError.syntax("invalid surrogate pair")
                }
                let combined = 0x10000 + ((scalar - 0xD800) << 10) + (low - 0xDC00)
                scalar = combined
            } else if scalar >= 0xDC00 && scalar <= 0xDFFF {
                throw JSONError.syntax("unpaired low surrogate escape")
            }
            appendScalar(scalar, into: &content)
        default:
            throw JSONError.syntax("invalid escape")
        }
    }

    private mutating func parseHex4() throws -> UInt32 {
        var value: UInt32 = 0
        for _ in 0..<4 {
            guard let byte = current else {
                throw JSONError.syntax("truncated \\u escape")
            }
            let digit: UInt32
            switch byte {
            case UInt8(ascii: "0")...UInt8(ascii: "9"): digit = UInt32(byte - UInt8(ascii: "0"))
            case UInt8(ascii: "a")...UInt8(ascii: "f"): digit = UInt32(byte - UInt8(ascii: "a")) + 10
            case UInt8(ascii: "A")...UInt8(ascii: "F"): digit = UInt32(byte - UInt8(ascii: "A")) + 10
            default:
                throw JSONError.syntax("invalid \\u escape")
            }
            value = value << 4 | digit
            index += 1
        }
        return value
    }

    private func appendScalar(_ scalar: UInt32, into content: inout [UInt8]) {
        let value = UInt32(scalar)
        if value < 0x80 {
            content.append(UInt8(value))
        } else if value < 0x800 {
            content.append(UInt8(0xC0 | (value >> 6)))
            content.append(UInt8(0x80 | (value & 0x3F)))
        } else if value < 0x10000 {
            content.append(UInt8(0xE0 | (value >> 12)))
            content.append(UInt8(0x80 | ((value >> 6) & 0x3F)))
            content.append(UInt8(0x80 | (value & 0x3F)))
        } else {
            content.append(UInt8(0xF0 | (value >> 18)))
            content.append(UInt8(0x80 | ((value >> 12) & 0x3F)))
            content.append(UInt8(0x80 | ((value >> 6) & 0x3F)))
            content.append(UInt8(0x80 | (value & 0x3F)))
        }
    }

    private mutating func parseNumber() throws -> String {
        let start = index
        if current == UInt8(ascii: "-") {
            index += 1
        }
        guard let first = current, first >= UInt8(ascii: "0"), first <= UInt8(ascii: "9") else {
            throw JSONError.syntax("invalid number")
        }
        if first == UInt8(ascii: "0") {
            index += 1
        } else {
            while let byte = current, byte >= UInt8(ascii: "0"), byte <= UInt8(ascii: "9") {
                index += 1
            }
        }
        if current == UInt8(ascii: ".") {
            index += 1
            guard let byte = current, byte >= UInt8(ascii: "0"), byte <= UInt8(ascii: "9") else {
                throw JSONError.syntax("invalid number fraction")
            }
            while let byte = current, byte >= UInt8(ascii: "0"), byte <= UInt8(ascii: "9") {
                index += 1
            }
        }
        if let byte = current, byte == UInt8(ascii: "e") || byte == UInt8(ascii: "E") {
            index += 1
            if let sign = current, sign == UInt8(ascii: "+") || sign == UInt8(ascii: "-") {
                index += 1
            }
            guard let byte = current, byte >= UInt8(ascii: "0"), byte <= UInt8(ascii: "9") else {
                throw JSONError.syntax("invalid number exponent")
            }
            while let byte = current, byte >= UInt8(ascii: "0"), byte <= UInt8(ascii: "9") {
                index += 1
            }
        }
        let spelling = String(decoding: bytes[start..<index], as: UTF8.self)
        return spelling
    }
}

/// Canonical serializer: object keys sorted by Unicode scalar order
/// (UTF-8 byte order), no insignificant whitespace, numeric spellings
/// verbatim, non-ASCII string content emitted raw.
public func serializeJSON(_ value: JSONValue) -> String {
    var out = ""
    writeValue(value, into: &out)
    return out
}

private func writeValue(_ value: JSONValue, into out: inout String) {
    switch value {
    case .null:
        out += "null"
    case .bool(let flag):
        out += flag ? "true" : "false"
    case .string(let text):
        writeString(text, into: &out)
    case .number(let spelling):
        out += spelling
    case .array(let values):
        out += "["
        for (index, element) in values.enumerated() {
            if index > 0 {
                out += ","
            }
            writeValue(element, into: &out)
        }
        out += "]"
    case .object(let object):
        out += "{"
        let sortedKeys = object.keys.sorted { left, right in
            left.utf8.lexicographicallyPrecedes(right.utf8)
        }
        for (position, key) in sortedKeys.enumerated() {
            if position > 0 {
                out += ","
            }
            writeString(key, into: &out)
            out += ":"
            writeValue(object[key] ?? .null, into: &out)
        }
        out += "}"
    }
}

private func writeString(_ text: String, into out: inout String) {
    out += "\""
    for scalar in text.unicodeScalars {
        switch scalar {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\u{08}": out += "\\b"
        case "\u{0C}": out += "\\f"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if scalar.value < 0x20 {
                out += String(format: "\\u%04x", scalar.value)
            } else {
                out.unicodeScalars.append(scalar)
            }
        }
    }
    out += "\""
}

/// Wire-level helpers shared with generated codecs.
public enum ExecSpecWire {
    /// Canonical int64 decimal spelling: optional '-', no leading zeros,
    /// no "-0". Used by the tagged {"$i64": spelling} encoding.
    public static func isCanonicalInt64Spelling(_ spelling: String) -> Bool {
        let scalars = Array(spelling.unicodeScalars)
        if scalars.isEmpty {
            return false
        }
        var start = 0
        if scalars[0] == "-" {
            start = 1
            if scalars.count == 1 {
                return false
            }
        }
        let digits = scalars[start...]
        guard let first = digits.first, isDigit(first) else {
            return false
        }
        if first == "0" && digits.count > 1 {
            return false
        }
        for scalar in digits.dropFirst() where !isDigit(scalar) {
            return false
        }
        if spelling == "-0" {
            return false
        }
        return true
    }

    private static func isDigit(_ scalar: Unicode.Scalar) -> Bool {
        scalar >= "0" && scalar <= "9"
    }
}

package com.execspec.runtime;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Strict JSON parser: rejects duplicate keys, preserves numeric
 *  spellings, validates Unicode escapes. */
public final class JSONParser {
    private final String text;
    private int index;

    private JSONParser(String text) {
        this.text = text;
        this.index = 0;
    }

    public static JSONValue parse(String input) {
        JSONParser parser = new JSONParser(input);
        parser.skipWhitespace();
        JSONValue value = parser.parseValue();
        parser.skipWhitespace();
        if (parser.index < parser.text.length()) {
            throw new IllegalArgumentException("trailing characters after JSON value");
        }
        return value;
    }

    private int peek() {
        return index < text.length() ? text.charAt(index) : -1;
    }

    private void skipWhitespace() {
        while (index < text.length()) {
            char c = text.charAt(index);
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                index++;
            } else {
                break;
            }
        }
    }

    private JSONValue parseValue() {
        skipWhitespace();
        int c = peek();
        if (c == -1) throw new IllegalArgumentException("unexpected end of input");
        return switch (c) {
            case '{' -> parseObject();
            case '[' -> parseArray();
            case '"' -> new JSONValue.Str(parseString());
            case 't' -> { expect("true"); yield new JSONValue.Bool(true); }
            case 'f' -> { expect("false"); yield new JSONValue.Bool(false); }
            case 'n' -> { expect("null"); yield new JSONValue.Null(); }
            default -> {
                if (c == '-' || (c >= '0' && c <= '9')) yield new JSONValue.Num(parseNumber());
                else throw new IllegalArgumentException("unexpected character: " + (char) c);
            }
        };
    }

    private void expect(String literal) {
        if (!text.startsWith(literal, index)) {
            throw new IllegalArgumentException("invalid literal at " + index);
        }
        index += literal.length();
    }

    private JSONValue parseObject() {
        index++; // '{'
        Map<String, JSONValue> map = new LinkedHashMap<>();
        skipWhitespace();
        if (peek() == '}') { index++; return new JSONValue.Obj(map); }
        while (true) {
            skipWhitespace();
            if (peek() != '"') throw new IllegalArgumentException("expected object key");
            String key = parseString();
            skipWhitespace();
            if (peek() != ':') throw new IllegalArgumentException("expected ':'");
            index++;
            skipWhitespace();
            JSONValue value = parseValue();
            if (map.containsKey(key)) {
                throw new IllegalArgumentException("duplicate key: " + key);
            }
            map.put(key, value);
            skipWhitespace();
            if (peek() == ',') { index++; continue; }
            if (peek() == '}') { index++; return new JSONValue.Obj(map); }
            throw new IllegalArgumentException("expected ',' or '}'");
        }
    }

    private JSONValue parseArray() {
        index++; // '['
        List<JSONValue> list = new ArrayList<>();
        skipWhitespace();
        if (peek() == ']') { index++; return new JSONValue.Arr(list); }
        while (true) {
            skipWhitespace();
            list.add(parseValue());
            skipWhitespace();
            if (peek() == ',') { index++; continue; }
            if (peek() == ']') { index++; return new JSONValue.Arr(list); }
            throw new IllegalArgumentException("expected ',' or ']'");
        }
    }

    private String parseString() {
        index++; // '"'
        StringBuilder sb = new StringBuilder();
        while (true) {
            if (index >= text.length()) throw new IllegalArgumentException("unterminated string");
            char c = text.charAt(index);
            if (c == '"') { index++; return sb.toString(); }
            if (c == '\\') {
                index++;
                sb.append(parseEscape());
            } else if (c < 0x20) {
                throw new IllegalArgumentException("raw control character in string");
            } else {
                sb.append(c);
                index++;
            }
        }
    }

    private String parseEscape() {
        char c = text.charAt(index++);
        return switch (c) {
            case '"' -> "\"";
            case '\\' -> "\\";
            case '/' -> "/";
            case 'b' -> "\b";
            case 'f' -> "\f";
            case 'n' -> "\n";
            case 'r' -> "\r";
            case 't' -> "\t";
            case 'u' -> parseUnicodeEscape();
            default -> throw new IllegalArgumentException("invalid escape: \\" + c);
        };
    }

    private String parseUnicodeEscape() {
        int high = parseHex4();
        if (high >= 0xD800 && high <= 0xDBFF) {
            if (index + 1 >= text.length() || text.charAt(index) != '\\' || text.charAt(index + 1) != 'u') {
                throw new IllegalArgumentException("unpaired surrogate escape");
            }
            index += 2;
            int low = parseHex4();
            if (low < 0xDC00 || low > 0xDFFF) {
                throw new IllegalArgumentException("invalid surrogate pair");
            }
            return String.valueOf((char) high) + (char) low;
        } else if (high >= 0xDC00 && high <= 0xDFFF) {
            throw new IllegalArgumentException("unpaired low surrogate escape");
        }
        return String.valueOf((char) high);
    }

    private int parseHex4() {
        int value = 0;
        for (int i = 0; i < 4; i++) {
            int c = peek();
            int digit;
            if (c >= '0' && c <= '9') digit = c - '0';
            else if (c >= 'a' && c <= 'f') digit = c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') digit = c - 'A' + 10;
            else throw new IllegalArgumentException("invalid hex digit");
            value = (value << 4) | digit;
            index++;
        }
        return value;
    }

    private String parseNumber() {
        int start = index;
        if (peek() == '-') index++;
        if (peek() == '0') {
            index++;
        } else if (peek() >= '1' && peek() <= '9') {
            while (peek() >= '0' && peek() <= '9') index++;
        } else {
            throw new IllegalArgumentException("invalid number");
        }
        if (peek() == '.') {
            index++;
            if (peek() < '0' || peek() > '9') throw new IllegalArgumentException("invalid fraction");
            while (peek() >= '0' && peek() <= '9') index++;
        }
        if (peek() == 'e' || peek() == 'E') {
            index++;
            if (peek() == '+' || peek() == '-') index++;
            if (peek() < '0' || peek() > '9') throw new IllegalArgumentException("invalid exponent");
            while (peek() >= '0' && peek() <= '9') index++;
        }
        return text.substring(start, index);
    }
}

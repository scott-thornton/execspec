package com.execspec.runtime;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Strict JSON value model. Numeric spellings are preserved as-is
 * (the semantic int64 and float64 types use tagged strings, never raw
 * JSON numbers). Duplicate keys are rejected by the parser.
 */
public sealed interface JSONValue {
    record Null() implements JSONValue {}
    record Bool(boolean value) implements JSONValue {}
    record Str(String value) implements JSONValue {}
    record Num(String spelling) implements JSONValue {}
    record Arr(List<JSONValue> items) implements JSONValue {}
    record Obj(Map<String, JSONValue> entries) implements JSONValue {}

    static JSONValue null_() { return new Null(); }
    static JSONValue bool(boolean v) { return new Bool(v); }
    static JSONValue str(String v) { return new Str(v); }
    static JSONValue arr(List<JSONValue> items) { return new Arr(items); }
    static JSONValue obj(Map<String, JSONValue> entries) { return new Obj(entries); }
}

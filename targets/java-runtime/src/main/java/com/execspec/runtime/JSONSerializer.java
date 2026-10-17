package com.execspec.runtime;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** Deterministic JSON serializer: sorted keys, no whitespace,
 *  numeric spellings verbatim. */
public final class JSONSerializer {
    private JSONSerializer() {}

    public static String serialize(JSONValue value) {
        StringBuilder sb = new StringBuilder();
        writeValue(value, sb);
        return sb.toString();
    }

    private static void writeValue(JSONValue value, StringBuilder sb) {
        if (value instanceof JSONValue.Null) {
            sb.append("null");
        } else if (value instanceof JSONValue.Bool b) {
            sb.append(b.value() ? "true" : "false");
        } else if (value instanceof JSONValue.Str s) {
            writeString(s.value(), sb);
        } else if (value instanceof JSONValue.Num n) {
            sb.append(n.spelling());
        } else if (value instanceof JSONValue.Arr a) {
            sb.append('[');
            List<JSONValue> items = a.items();
            for (int i = 0; i < items.size(); i++) {
                if (i > 0) sb.append(',');
                writeValue(items.get(i), sb);
            }
            sb.append(']');
        } else if (value instanceof JSONValue.Obj o) {
            sb.append('{');
            Map<String, JSONValue> sorted = new TreeMap<>(o.entries());
            boolean first = true;
            for (Map.Entry<String, JSONValue> entry : sorted.entrySet()) {
                if (!first) sb.append(',');
                first = false;
                writeString(entry.getKey(), sb);
                sb.append(':');
                writeValue(entry.getValue(), sb);
            }
            sb.append('}');
        }
    }

    private static void writeString(String s, StringBuilder sb) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> {
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }
}

/** Java codec emission: strict decode/encode per named type. */

import type { SemanticIR, TypeDeclaration, ValueType } from "@execspec/core";
import { javaPropertyName, javaTypeName } from "./identifiers.js";
import { javaValueTypeName } from "./emit.js";

export function decoderExpression(type: ValueType): string {
  return type.kind === "ref" ? `decode${javaTypeName(type.typeId)}` : `decodeValue_${type.kind}`;
}

export function encoderExpression(type: ValueType): string {
  return type.kind === "ref" ? `encode${javaTypeName(type.typeId)}` : `encodeValue_${type.kind}`;
}

export function emitJavaCodecs(ir: SemanticIR): string {
  const chunks: string[] = [];
  chunks.push(emitPrimitiveCodecs());
  for (const declaration of ir.types as readonly TypeDeclaration[]) {
    if (declaration.kind === "struct") {
      chunks.push(emitStructCodec(declaration));
    } else if (declaration.kind === "enum") {
      chunks.push(emitEnumCodec(declaration));
    } else {
      chunks.push(emitUnionCodec(declaration));
    }
  }
  return chunks.join("\n\n");
}

function emitPrimitiveCodecs(): string {
  return `    static Unit decodeValue_unit(JSONValue value) {
        if (value instanceof JSONValue.Obj obj && obj.entries().isEmpty()) return Unit.INSTANCE;
        throw fail("unit: expected {}");
    }

    static JSONValue encodeValue_unit(Unit value) {
        return JSONValue.obj(new LinkedHashMap<>());
    }

    static boolean decodeValue_boolean(JSONValue value) {
        if (value instanceof JSONValue.Bool b) return b.value();
        throw fail("boolean: expected a JSON boolean");
    }

    static JSONValue encodeValue_boolean(boolean value) {
        return JSONValue.bool(value);
    }

    static long decodeValue_int64(JSONValue value) {
        if (value instanceof JSONValue.Obj obj && obj.entries().size() == 1
                && obj.entries().get("$i64") instanceof JSONValue.Str s) {
            if (!s.value().matches("-?(0|[1-9][0-9]*)") || "-0".equals(s.value())) {
                throw fail("int64: invalid spelling '" + s.value() + "'");
            }
            try {
                return Long.parseLong(s.value());
            } catch (NumberFormatException e) {
                throw fail("int64: out of range: " + s.value());
            }
        }
        throw fail("int64: expected {\\"$i64\\":\\"...\\"}");
    }

    static JSONValue encodeValue_int64(long value) {
        Map<String, JSONValue> m = new LinkedHashMap<>();
        m.put("$i64", JSONValue.str(String.valueOf(value)));
        return JSONValue.obj(m);
    }

    static double decodeValue_float64(JSONValue value) {
        if (value instanceof JSONValue.Obj obj && obj.entries().size() == 1
                && obj.entries().get("$f64") instanceof JSONValue.Str s) {
            String canonical = canonicalFloat64(Double.parseDouble(s.value()));
            if (!canonical.equals(s.value())) {
                throw fail("float64: non-canonical spelling '" + s.value() + "'");
            }
            return Double.parseDouble(s.value());
        }
        throw fail("float64: expected {\\"$f64\\":\\"...\\"}");
    }

    static JSONValue encodeValue_float64(double value) {
        Map<String, JSONValue> m = new LinkedHashMap<>();
        m.put("$f64", JSONValue.str(canonicalFloat64(value)));
        return JSONValue.obj(m);
    }

    static String canonicalFloat64(double value) {
        if (Double.isNaN(value)) return "NaN";
        if (value == Double.POSITIVE_INFINITY) return "Infinity";
        if (value == Double.NEGATIVE_INFINITY) return "-Infinity";
        if (value == 0.0) return "0";
        // ECMAScript-compatible shortest round-trip
        return ecmaDouble(value);
    }

    private static String ecmaDouble(double value) {
        boolean negative = value < 0 || (value == 0.0 && Double.doubleToRawLongBits(value) < 0);
        double magnitude = Math.abs(value);
        for (int precision = 1; precision <= 17; precision++) {
            String candidate = String.format("%." + (precision - 1) + "e", magnitude);
            double parsed = Double.parseDouble(candidate);
            if (Double.doubleToRawLongBits(parsed) == Double.doubleToRawLongBits(magnitude)) {
                return formatEcma(negative, candidate);
            }
        }
        return formatEcma(negative, String.format("%.16e", magnitude));
    }

    private static String formatEcma(boolean negative, String scientific) {
        // Parse "d.ddde±XX" and apply ECMAScript ToString rules
        String[] parts = scientific.split("e");
        String mantissa = parts[0].contains(".") ? parts[0].replaceAll("0+$", "").replaceAll("\\\\.$", "") : parts[0];
        if (mantissa.isEmpty()) mantissa = "0";
        String digits = mantissa.replace(".", "");
        digits = digits.replaceAll("^0+", "");
        if (digits.isEmpty()) digits = "0";
        int exponent = Integer.parseInt(parts[1]) + 1;
        int k = digits.length();
        String sign = negative ? "-" : "";
        if (k <= exponent && exponent <= 21) {
            return sign + digits + "0".repeat(exponent - k);
        }
        if (0 < exponent && exponent <= 21) {
            return sign + digits.substring(0, exponent) + "." + digits.substring(exponent);
        }
        if (-6 < exponent && exponent <= 0) {
            return sign + "0." + "0".repeat(-exponent) + digits;
        }
        String mantissa2 = k == 1 ? digits : digits.substring(0, 1) + "." + digits.substring(1);
        int exp = exponent - 1;
        return sign + mantissa2 + "e" + (exp < 0 ? "-" : "+") + Math.abs(exp);
    }

    static String decodeValue_string(JSONValue value) {
        if (value instanceof JSONValue.Str s) return s.value();
        throw fail("string: expected a JSON string");
    }

    static JSONValue encodeValue_string(String value) {
        return JSONValue.str(value);
    }

    static byte[] decodeValue_bytes(JSONValue value) {
        if (value instanceof JSONValue.Obj obj && obj.entries().size() == 1
                && obj.entries().get("$b64") instanceof JSONValue.Str s) {
            try {
                byte[] decoded = java.util.Base64.getDecoder().decode(s.value());
                String reencoded = java.util.Base64.getEncoder().encodeToString(decoded);
                if (!reencoded.equals(s.value())) {
                    throw fail("bytes: non-canonical base64: '" + s.value() + "'");
                }
                return decoded;
            } catch (IllegalArgumentException e) {
                throw fail("bytes: invalid base64: '" + s.value() + "'");
            }
        }
        throw fail("bytes: expected {\\"$b64\\":\\"...\\"}");
    }

    static JSONValue encodeValue_bytes(byte[] value) {
        Map<String, JSONValue> m = new LinkedHashMap<>();
        m.put("$b64", JSONValue.str(java.util.Base64.getEncoder().encodeToString(value)));
        return JSONValue.obj(m);
    }

    static <T> List<T> decodeValue_list(JSONValue value, java.util.function.Function<JSONValue, T> decoder) {
        if (value instanceof JSONValue.Arr arr) {
            List<T> result = new ArrayList<>();
            for (JSONValue item : arr.items()) result.add(decoder.apply(item));
            return result;
        }
        throw fail("list: expected a JSON array");
    }

    static JSONValue encodeValue_list(List<? extends Object> value, java.util.function.Function<Object, JSONValue> encoder) {
        List<JSONValue> items = new ArrayList<>();
        for (Object item : value) items.add(encoder.apply(item));
        return JSONValue.arr(items);
    }

    private static RuntimeException fail(String message) {
        return new Host.HostFailure("invalidRequest", message);
    }`;
}

function emitStructCodec(
  declaration: { readonly id: string; readonly fields: readonly { readonly name: string; readonly type: ValueType; readonly optional: boolean }[] },
): string {
  const name = javaTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`    static ${name} decode${name}(JSONValue value) {`);
  lines.push(`        if (!(value instanceof JSONValue.Obj obj)) throw fail("${name}: expected a JSON object");`);
  lines.push(`        for (String key : obj.entries().keySet()) {`);
  lines.push(`            boolean known = ${declaration.fields.map((f) => `"${f.name}".equals(key)`).join(" || ")};`);
  lines.push(`            if (!known) throw fail("${name}: unknown field '" + key + "'");`);
  lines.push(`        }`);

  for (const field of declaration.fields) {
    const prop = javaPropertyName(field.name);
    if (field.optional) {
      const boxed = javaValueTypeName(field.type) === "boolean" ? "Boolean"
        : javaValueTypeName(field.type) === "long" ? "Long"
        : javaValueTypeName(field.type) === "double" ? "Double"
        : javaValueTypeName(field.type);
      lines.push(`        ${boxed} ${prop} = null;`);
      lines.push(`        if (obj.entries().get("${field.name}") != null) {`);
      lines.push(`            JSONValue raw = obj.entries().get("${field.name}");`);
      lines.push(`            if (raw instanceof JSONValue.Null) throw fail("${name}: field '${field.name}' must not be null");`);
      lines.push(`            ${prop} = ${decoderExpression(field.type)}(raw);`);
      lines.push(`        }`);
    } else {
      lines.push(`        JSONValue raw${capitalize(prop)} = obj.entries().get("${field.name}");`);
      lines.push(`        if (raw${capitalize(prop)} == null) throw fail("${name}: missing required field '${field.name}'");`);
      lines.push(`        if (raw${capitalize(prop)} instanceof JSONValue.Null) throw fail("${name}: field '${field.name}' must not be null");`);
    }
  }

  const args = declaration.fields.map((field) => {
    const prop = javaPropertyName(field.name);
    if (field.optional) return prop;
    return `${decoderExpression(field.type)}(raw${capitalize(prop)})`;
  }).join(", ");
  lines.push(`        return new ${name}(${args});`);
  lines.push(`    }`);
  lines.push("");
  lines.push(`    static JSONValue encode${name}(${name} value) {`);
  lines.push(`        Map<String, JSONValue> m = new LinkedHashMap<>();`);
  for (const field of declaration.fields) {
    const getter = `get${capitalize(javaPropertyName(field.name))}()`;
    if (field.optional) {
      const boxed = javaValueTypeName(field.type) === "boolean" ? "Boolean"
        : javaValueTypeName(field.type) === "long" ? "Long"
        : javaValueTypeName(field.type) === "double" ? "Double"
        : javaValueTypeName(field.type);
      lines.push(`        if (value.${getter} != null) m.put("${field.name}", ${encoderExpression(field.type)}(value.${getter}));`);
    } else {
      lines.push(`        m.put("${field.name}", ${encoderExpression(field.type)}(value.${getter}));`);
    }
  }
  lines.push(`        return JSONValue.obj(m);`);
  lines.push(`    }`);
  return lines.join("\n");
}

function emitEnumCodec(
  declaration: { readonly id: string; readonly cases: readonly string[] },
): string {
  const name = javaTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`    static ${name} decode${name}(JSONValue value) {`);
  lines.push(`        if (value instanceof JSONValue.Str s) {`);
  lines.push(`            try { return ${name}.valueOf(s.value()); }`);
  lines.push(`            catch (IllegalArgumentException e) { throw fail("${name}: unknown case '" + s.value() + "'"); }`);
  lines.push(`        }`);
  lines.push(`        throw fail("${name}: expected a JSON string");`);
  lines.push(`    }`);
  lines.push("");
  lines.push(`    static JSONValue encode${name}(${name} value) {`);
  lines.push(`        return JSONValue.str(value.name());`);
  lines.push(`    }`);
  return lines.join("\n");
}

function emitUnionCodec(
  declaration: { readonly id: string; readonly cases: readonly { readonly name: string; readonly payload: ValueType }[] },
): string {
  const name = javaTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`    @SuppressWarnings("unchecked")`);
  lines.push(`    static ${name} decode${name}(JSONValue value) {`);
  lines.push(`        if (!(value instanceof JSONValue.Obj obj)) throw fail("${name}: expected a JSON object");`);
  lines.push(`        if (!(obj.entries().get("$case") instanceof JSONValue.Str caseStr)) throw fail("${name}: missing '$case'");`);
  lines.push(`        switch (caseStr.value()) {`);
  for (const unionCase of declaration.cases) {
    const caseName = capitalize(javaPropertyName(unionCase.name));
    if (unionCase.payload.kind === "unit") {
      lines.push(`            case "${unionCase.name}":`);
      lines.push(`                if (obj.entries().size() != 1) throw fail("${name}: case '${unionCase.name}' must not carry 'value'");`);
      lines.push(`                return ${name}.${caseName}.INSTANCE;`);
    } else {
      lines.push(`            case "${unionCase.name}":`);
      lines.push(`                if (obj.entries().size() != 2 || !(obj.entries().get("value") instanceof JSONValue)) {`);
      lines.push(`                    throw fail("${name}: case '${unionCase.name}' requires exactly 'value'");`);
      lines.push(`                }`);
      lines.push(`                return new ${name}.${caseName}(${decoderExpression(unionCase.payload)}(obj.entries().get("value")));`);
    }
  }
  lines.push(`            default: throw fail("${name}: unknown case '" + caseStr.value() + "'");`);
  lines.push(`        }`);
  lines.push(`    }`);
  lines.push("");
  lines.push(`    static JSONValue encode${name}(${name} value) {`);
  lines.push(`        Map<String, JSONValue> m = new LinkedHashMap<>();`);
  for (const unionCase of declaration.cases) {
    const caseName = capitalize(javaPropertyName(unionCase.name));
    if (unionCase.payload.kind === "unit") {
      lines.push(`        if (value instanceof ${name}.${caseName}) {`);
      lines.push(`            m.put("$case", JSONValue.str("${unionCase.name}"));`);
      lines.push(`            return JSONValue.obj(m);`);
      lines.push(`        }`);
    } else {
      lines.push(`        if (value instanceof ${name}.${caseName} variant) {`);
      lines.push(`            m.put("$case", JSONValue.str("${unionCase.name}"));`);
      lines.push(`            m.put("value", ${encoderExpression(unionCase.payload)}(variant.value));`);
      lines.push(`            return JSONValue.obj(m);`);
      lines.push(`        }`);
    }
  }
  lines.push(`        throw fail("${name}: unknown variant");`);
  lines.push(`    }`);
  return lines.join("\n");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

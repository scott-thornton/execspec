// ExecSpecRuntime: canonical float64 spelling (docs/semantic-model.md
// §3.1, ADR). Produces exactly what ECMAScript's
// Number.prototype.toString() produces - shortest round-trip decimal,
// decimal notation for 1e-6 ≤ |x| < 1e21, exponent notation otherwise,
// "NaN"/"Infinity"/"-Infinity" literals, -0 → "0" - so every target
// emits identical wire bytes.

import Foundation

public enum ExecSpecFloat64 {
    public static func spelling(_ value: Double) -> String {
        if value.isNaN {
            return "NaN"
        }
        if value.isInfinite {
            return value < 0 ? "-Infinity" : "Infinity"
        }
        if value == 0 {
            return "0"
        }
        let negative = value.sign == .minus
        let magnitude = abs(value)
        for precision in 1...17 {
            let text = String(format: "%.\(precision - 1)e", magnitude)
            if let parsed = Double(text), parsed.bitPattern == magnitude.bitPattern {
                let parts = parseScientific(text)
                return format(negative: negative, digits: parts.digits, n: parts.n)
            }
        }
        // Unreachable in practice: 17 significant digits always round-trip.
        let parts = parseScientific(String(format: "%.16e", magnitude))
        return format(negative: negative, digits: parts.digits, n: parts.n)
    }

    public static func parse(_ spelling: String) -> Double? {
        switch spelling {
        case "NaN":
            return Double.nan
        case "Infinity":
            return Double.infinity
        case "-Infinity":
            return -Double.infinity
        default:
            return Double(spelling)
        }
    }
}

/// "d.ddde±XX" → (significant digits with trailing zeros stripped, n
/// where value = 0.digits × 10^n).
private func parseScientific(_ text: String) -> (digits: String, n: Int) {
    let parts = text.split(separator: "e")
    let mantissa = String(parts[0])
    let exponent = Int(parts[1]) ?? 0
    var digits = mantissa.filter { $0.isNumber }
    while digits.count > 1 && digits.hasSuffix("0") {
        digits.removeLast()
    }
    return (digits, exponent + 1)
}

/// ECMAScript ToString formatting rules given digits d1..dk and n.
private func format(negative: Bool, digits: String, n: Int) -> String {
    let sign = negative ? "-" : ""
    let characters = Array(digits)
    let k = characters.count
    if k <= n && n <= 21 {
        return "\(sign)\(digits)\(String(repeating: "0", count: n - k))"
    }
    if 0 < n && n <= 21 {
        return "\(sign)\(String(characters[0..<n])).\(String(characters[n..<k]))"
    }
    if -6 < n && n <= 0 {
        return "\(sign)0.\(String(repeating: "0", count: -n))\(digits)"
    }
    let mantissa = k == 1 ? digits : "\(characters[0]).\(String(characters[1...]))"
    let exponent = n - 1
    let exponentText = exponent < 0 ? "e-\(-exponent)" : "e+\(exponent)"
    return "\(sign)\(mantissa)\(exponentText)"
}

import Foundation
import Testing
@testable import ExecSpecRuntime

@Suite struct Float64SpellingTests {
    @Test func matchesECMAScriptToString() {
        let cases: [Double: String] = [
            0: "0",
            0.5: "0.5",
            1.5: "1.5",
            100: "100",
            150: "150",
            0.000001: "0.000001",
            1e-7: "1e-7",
            1e21: "1e+21",
            9.999999999999999e20: "999999999999999900000",
            9007199254740991: "9007199254740991",
            1.7976931348623157e308: "1.7976931348623157e+308",
            5e-324: "5e-324",
            0.1: "0.1",
            0.3: "0.3",
            1 / 3: "0.3333333333333333",
            -42.25: "-42.25",
            Double.nan: "NaN",
            Double.infinity: "Infinity",
            -Double.infinity: "-Infinity",
        ]
        #expect(ExecSpecFloat64.spelling(-0.0) == "0")
        for (value, expected) in cases {
            let spelled = ExecSpecFloat64.spelling(value)
            #expect(spelled == expected, "\(value) → \(spelled), expected \(expected)")
        }
    }

    @Test func roundTripsThroughParse() {
        for value in [0.0, -0.0, 0.1, 1e21, 1e-7, Double.greatestFiniteMagnitude, 5e-324, 123.456e100] {
            let spelled = ExecSpecFloat64.spelling(value)
            let parsed = ExecSpecFloat64.parse(spelled)
            #expect(parsed != nil)
            if let parsed {
                #expect(parsed.bitPattern == value.bitPattern || (value == 0 && parsed == 0))
            }
        }
        #expect(ExecSpecFloat64.parse("NaN")!.isNaN)
        #expect(ExecSpecFloat64.parse("Infinity") == Double.infinity)
        #expect(ExecSpecFloat64.parse("-Infinity") == -Double.infinity)
    }

    @Test func parseRejectsNonCanonicalSpellings() {
        for spelling in [".5", "01", "1e5", "+1", "-0.0", "nan", "infinity", "1_000"] {
            let parsed = ExecSpecFloat64.parse(spelling)
            let canonical = parsed.map { ExecSpecFloat64.spelling($0) == spelling } ?? false
            #expect(!canonical, Comment(stringLiteral: spelling))
        }
    }
}

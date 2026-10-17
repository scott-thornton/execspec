import Foundation
import Testing
@testable import ExecSpecRuntime

/// Consumes the language-neutral conformance corpus directly from the
/// repository (vectors/conformance.json). This is independent
/// verification: none of @execspec/core is involved.
struct ConformanceCorpus: Codable {
    struct ParserCase: Codable { let text: String }
    struct CorpusSection<T: Codable>: Codable { let accept: [T]?; let reject: [String]? }
    struct FloatPair: Codable { let of: String; let spelling: String }
    struct Base64Case: Codable { let spelling: String; let hex: String }
    struct DigestVector: Codable { let name: String; let domain: String; let canonical: String; let digest: String }
    struct FloatSection: Codable { let pairs: [FloatPair]?; let reject: [String]? }
    struct Base64Section: Codable { let accept: [Base64Case]?; let reject: [String]? }
    let jsonParser: CorpusSection<ParserCase>
    let int64Spelling: CorpusSection<String>
    let float64Spelling: FloatSection
    let bytesBase64: Base64Section
    let digestVectors: [DigestVector]

    static func load() throws -> ConformanceCorpus {
        let testFile = URL(fileURLWithPath: #filePath)
        let corpusURL = testFile
            .deletingLastPathComponent()      // ExecSpecRuntimeTests
            .deletingLastPathComponent()      // Tests
            .deletingLastPathComponent()      // swift-runtime
            .deletingLastPathComponent()      // targets
            .deletingLastPathComponent()      // repo root
            .appendingPathComponent("vectors/conformance.json")
        return try JSONDecoder().decode(ConformanceCorpus.self, from: Data(contentsOf: corpusURL))
    }
}

@Suite struct ConformanceVectorTests {
    let corpus = try! ConformanceCorpus.load()

    @Test func jsonParserVectors() throws {
        for (index, entry) in (corpus.jsonParser.accept ?? []).enumerated() {
            _ = try JSONParser.parse(entry.text)
            #expect(Bool(true), Comment(stringLiteral: "accept[\(index)] \(entry.text)"))
        }
        for (index, text) in (corpus.jsonParser.reject ?? []).enumerated() {
            #expect(throws: JSONError.self, Comment(stringLiteral: "reject[\(index)] \(text)")) {
                _ = try JSONParser.parse(text)
            }
        }
    }

    @Test func int64SpellingVectors() {
        for (index, spelling) in (corpus.int64Spelling.accept ?? []).enumerated() {
            #expect(ExecSpecWire.isCanonicalInt64Spelling(spelling), Comment(stringLiteral: "accept[\(index)] \(spelling)"))
        }
        for (index, spelling) in (corpus.int64Spelling.reject ?? []).enumerated() {
            #expect(!ExecSpecWire.isCanonicalInt64Spelling(spelling), Comment(stringLiteral: "reject[\(index)] \(spelling)"))
        }
    }

    @Test func float64SpellingVectors() throws {
        for (index, pair) in (corpus.float64Spelling.pairs ?? []).enumerated() {
            let value: Double
            switch pair.of {
            case "NaN": value = .nan
            case "Infinity": value = .infinity
            case "-Infinity": value = -.infinity
            default: value = try #require(Double(pair.of))
            }
            #expect(ExecSpecFloat64.spelling(value) == pair.spelling, Comment(stringLiteral: "pair[\(index)] \(pair.of)"))
            #expect(try ExecSpecFloat64.parse(pair.spelling).map { ExecSpecFloat64.spelling($0) == pair.spelling } == true)
        }
        for (index, spelling) in (corpus.float64Spelling.reject ?? []).enumerated() {
            let canonical = ExecSpecFloat64.parse(spelling).map { ExecSpecFloat64.spelling($0) == spelling } ?? false
            #expect(!canonical, Comment(stringLiteral: "reject[\(index)] \(spelling)"))
        }
    }

    @Test func bytesBase64Vectors() {
        for (index, entry) in (corpus.bytesBase64.accept ?? []).enumerated() {
            let data = Data(base64Encoded: entry.spelling)
            #expect(data != nil, Comment(stringLiteral: "accept[\(index)] \(entry.spelling)"))
            if let data {
                let hex = data.map { String(format: "%02x", $0) }.joined()
                #expect(hex == entry.hex, Comment(stringLiteral: "accept[\(index)] hex"))
                #expect(data.base64EncodedString() == entry.spelling, Comment(stringLiteral: "accept[\(index)] roundtrip"))
            }
        }
        for (index, spelling) in (corpus.bytesBase64.reject ?? []).enumerated() {
            let canonical = (Data(base64Encoded: spelling) ?? Data()).base64EncodedString() == spelling
            #expect(!canonical, Comment(stringLiteral: "reject[\(index)] \(spelling)"))
        }
    }

    @Test func digestVectors() throws {
        for vector in corpus.digestVectors {
            #expect(vector.domain == "execspec-semantic-1")
            let prefixed = vector.domain.data(using: .utf8)! + Data([0x00]) + vector.canonical.data(using: .utf8)!
            // Independent hashing (CryptoKit-free, via CommonCrypto-free manual SHA-256 is overkill;
            // use Foundation's SHA256 from CryptoKit).
            let digest = SHA256Hex(prefixed)
            #expect(digest == vector.digest, Comment(stringLiteral: vector.name))
        }
    }
}

import CryptoKit

func SHA256Hex(_ data: Data) -> String {
    SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

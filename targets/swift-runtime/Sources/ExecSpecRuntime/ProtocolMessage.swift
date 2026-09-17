// ExecSpecRuntime: protocol v1 messages (docs/protocol-v1.md).
//
// Messages carry exactly the keys they declare; missing fields, wrong
// types, unknown kinds, and additional fields are all rejections.

import Foundation

public enum ProtocolMessageError: Error, Sendable {
    case malformed(String)
}

public struct ProtocolHello: Sendable, Equatable {
    public let protocolVersion: Int
    public let specificationDigest: String

    public init(protocolVersion: Int, specificationDigest: String) {
        self.protocolVersion = protocolVersion
        self.specificationDigest = specificationDigest
    }
}

public struct ProtocolHelloAck: Sendable, Equatable {
    public let protocolVersion: Int
    public let specificationDigest: String
    public let target: String

    public init(protocolVersion: Int, specificationDigest: String, target: String) {
        self.protocolVersion = protocolVersion
        self.specificationDigest = specificationDigest
        self.target = target
    }
}

public struct ProtocolRequest: Sendable, Equatable {
    public let id: String
    public let operation: String
    public let input: JSONValue

    public init(id: String, operation: String, input: JSONValue) {
        self.id = id
        self.operation = operation
        self.input = input
    }
}

public struct ProtocolResponse: Sendable, Equatable {
    public let id: String
    public let output: JSONValue

    public init(id: String, output: JSONValue) {
        self.id = id
        self.output = output
    }
}

public struct ProtocolFailure: Sendable, Equatable {
    public let id: String
    public let category: String
    public let message: String

    public init(id: String, category: String, message: String) {
        self.id = id
        self.category = category
        self.message = message
    }
}

public let execSpecProtocolVersion = 1

private func expectObject(
    _ value: JSONValue,
    keys: [String],
    scope: String
) throws -> [String: JSONValue] {
    guard case .object(let object) = value else {
        throw ProtocolMessageError.malformed("\(scope): expected a JSON object")
    }
    guard object.count == keys.count else {
        throw ProtocolMessageError.malformed("\(scope): expected exactly \(keys.count) fields")
    }
    for key in keys where object[key] == nil {
        throw ProtocolMessageError.malformed("\(scope): missing field '\(key)'")
    }
    return object
}

private func expectString(_ value: JSONValue, scope: String) throws -> String {
    guard case .string(let text) = value else {
        throw ProtocolMessageError.malformed("\(scope): expected a string")
    }
    return text
}

private func expectInt(_ value: JSONValue, scope: String) throws -> Int {
    guard case .number(let spelling) = value,
          let parsed = Int(spelling) else {
        throw ProtocolMessageError.malformed("\(scope): expected an integer")
    }
    return parsed
}

private func encodeInt(_ value: Int) -> JSONValue {
    .number(String(value))
}

public func decodeHello(_ value: JSONValue) throws -> ProtocolHello {
    let object = try expectObject(value, keys: ["kind", "protocolVersion", "specificationDigest"], scope: "hello")
    guard case .string(let kind) = object["kind"] ?? .null, kind == "hello" else {
        throw ProtocolMessageError.malformed("hello: wrong kind")
    }
    return ProtocolHello(
        protocolVersion: try expectInt(object["protocolVersion"] ?? .null, scope: "hello.protocolVersion"),
        specificationDigest: try expectString(object["specificationDigest"] ?? .null, scope: "hello.specificationDigest")
    )
}

public func encodeHello(_ hello: ProtocolHello) -> JSONValue {
    .object([
        "kind": .string("hello"),
        "protocolVersion": encodeInt(hello.protocolVersion),
        "specificationDigest": .string(hello.specificationDigest),
    ])
}

public func decodeHelloAck(_ value: JSONValue) throws -> ProtocolHelloAck {
    let object = try expectObject(value, keys: ["kind", "protocolVersion", "specificationDigest", "target"], scope: "helloAck")
    guard case .string(let kind) = object["kind"] ?? .null, kind == "helloAck" else {
        throw ProtocolMessageError.malformed("helloAck: wrong kind")
    }
    return ProtocolHelloAck(
        protocolVersion: try expectInt(object["protocolVersion"] ?? .null, scope: "helloAck.protocolVersion"),
        specificationDigest: try expectString(object["specificationDigest"] ?? .null, scope: "helloAck.specificationDigest"),
        target: try expectString(object["target"] ?? .null, scope: "helloAck.target")
    )
}

public func encodeHelloAck(_ ack: ProtocolHelloAck) -> JSONValue {
    .object([
        "kind": .string("helloAck"),
        "protocolVersion": encodeInt(ack.protocolVersion),
        "specificationDigest": .string(ack.specificationDigest),
        "target": .string(ack.target),
    ])
}

public func decodeRequest(_ value: JSONValue) throws -> ProtocolRequest {
    let object = try expectObject(value, keys: ["kind", "id", "operation", "input"], scope: "request")
    guard case .string(let kind) = object["kind"] ?? .null, kind == "request" else {
        throw ProtocolMessageError.malformed("request: wrong kind")
    }
    return ProtocolRequest(
        id: try expectString(object["id"] ?? .null, scope: "request.id"),
        operation: try expectString(object["operation"] ?? .null, scope: "request.operation"),
        input: object["input"] ?? .null
    )
}

public func encodeRequest(_ request: ProtocolRequest) -> JSONValue {
    .object([
        "kind": .string("request"),
        "id": .string(request.id),
        "operation": .string(request.operation),
        "input": request.input,
    ])
}

public func decodeResponse(_ value: JSONValue) throws -> ProtocolResponse {
    let object = try expectObject(value, keys: ["kind", "id", "output"], scope: "response")
    guard case .string(let kind) = object["kind"] ?? .null, kind == "response" else {
        throw ProtocolMessageError.malformed("response: wrong kind")
    }
    return ProtocolResponse(
        id: try expectString(object["id"] ?? .null, scope: "response.id"),
        output: object["output"] ?? .null
    )
}

public func encodeResponse(_ response: ProtocolResponse) -> JSONValue {
    .object([
        "kind": .string("response"),
        "id": .string(response.id),
        "output": response.output,
    ])
}

public func decodeFailure(_ value: JSONValue) throws -> ProtocolFailure {
    let object = try expectObject(value, keys: ["kind", "id", "category", "message"], scope: "failure")
    guard case .string(let kind) = object["kind"] ?? .null, kind == "failure" else {
        throw ProtocolMessageError.malformed("failure: wrong kind")
    }
    return ProtocolFailure(
        id: try expectString(object["id"] ?? .null, scope: "failure.id"),
        category: try expectString(object["category"] ?? .null, scope: "failure.category"),
        message: try expectString(object["message"] ?? .null, scope: "failure.message")
    )
}

public func encodeFailure(_ failure: ProtocolFailure) -> JSONValue {
    .object([
        "kind": .string("failure"),
        "id": .string(failure.id),
        "category": .string(failure.category),
        "message": .string(failure.message),
    ])
}

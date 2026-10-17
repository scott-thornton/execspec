// v2 spec: same as spec-module but EchoRequest has an optional "nickname" field.
import {
  specification, struct, union, string, int64, unit, ref, optional,
  operation, scenario, literal, binding,
  structValue, stringValue, unionValue, int64Value,
} from "@execspec/dsl";

const spec = specification({ name: "kv", version: "0.2.0" });

spec.type(struct("EchoRequest", { revision: int64(), nickname: optional(string()) }));
spec.type(struct("EchoResult", { revision: int64() }));
spec.type(union("GetResult", { found: string(), missing: unit() }));

spec.operation(operation("kv.echo", { input: ref("EchoRequest"), output: ref("EchoResult") }));
spec.operation(operation("kv.get", { input: unit(), output: ref("GetResult") }));

spec.scenario(
  scenario("kv.echo.roundtrip", "echoes")
    .call("echo", "kv.echo", literal(structValue("EchoRequest", new Map([
      ["revision", int64Value(1n)],
    ]))))
    .expectEqual(
      binding("echo"),
      literal(structValue("EchoResult", new Map([["revision", int64Value(1n)]]))),
    )
    .build(),
);

export default spec.build();

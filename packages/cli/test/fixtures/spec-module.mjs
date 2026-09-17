// Fixture specification module (default export: AuthoringGraph).
import {
  specification,
  struct,
  union,
  string,
  int64,
  unit,
  ref,
  operation,
  scenario,
  literal,
  binding,
  structValue,
  stringValue,
  unionValue,
  int64Value,
} from "@execspec/dsl";

const spec = specification({ name: "kv", version: "0.1.0" });

spec.type(struct("EchoRequest", { revision: int64() }));
spec.type(struct("EchoResult", { revision: int64() }));
spec.type(union("GetResult", { found: string(), missing: unit() }));

spec.operation(operation("kv.echo", { input: ref("EchoRequest"), output: ref("EchoResult") }));
spec.operation(operation("kv.get", { input: unit(), output: ref("GetResult") }));

spec.scenario(
  scenario("kv.echo.roundtrip", "full-width int64 survives the round trip")
    .call("echo", "kv.echo", literal(structValue("EchoRequest", new Map([["revision", int64Value(9223372036854775807n)]]))))
    .expectEqual(
      binding("echo"),
      literal(structValue("EchoResult", new Map([["revision", int64Value(9223372036854775807n)]]))),
    )
    .build(),
);

export default spec.build();

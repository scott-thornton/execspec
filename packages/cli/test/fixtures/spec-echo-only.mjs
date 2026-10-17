import {
  specification, struct, string, int64, ref,
  operation, scenario, literal, binding,
  structValue, stringValue, int64Value,
} from "@execspec/dsl";
const spec = specification({ name: "kv", version: "0.1.0" });
spec.type(struct("EchoRequest", { revision: int64() }));
spec.type(struct("EchoResult", { revision: int64() }));
spec.operation(operation("kv.echo", { input: ref("EchoRequest"), output: ref("EchoResult") }));
spec.scenario(
  scenario("kv.echo.roundtrip", "echoes")
    .call("echo", "kv.echo", literal(structValue("EchoRequest", new Map([["revision", int64Value(1n)]]))))
    .expectEqual(binding("echo"), literal(structValue("EchoResult", new Map([["revision", int64Value(1n)]]))))
    .build(),
);
export default spec.build();

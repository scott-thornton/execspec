// Fixture specification that must fail compilation.
import { specification, struct, string, unit, ref, operation, scenario, literal, binding, unitValue } from "@execspec/dsl";

const spec = specification({ name: "bad", version: "0.1.0" });
spec.type(struct("Thing", { key: string() }));
spec.operation(operation("bad.put", { input: ref("Nowhere"), output: unit() }));
spec.scenario(
  scenario("bad.a", "d")
    .call("put", "bad.put", literal(unitValue()))
    .expectEqual(binding("put"), literal(unitValue()))
    .build(),
);
export default spec.build();

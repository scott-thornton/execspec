// The KV implementation in TypeScript - the same contract the Swift
// KVStore implements, proving one specification, two languages.

import type {
  DeleteRequest,
  ExecSpecUnit,
  GetRequest,
  GetResult,
  KeyList,
  PutRequest,
  RevisionRequest,
  RevisionResult,
  TypesRequest,
  TypesResult,
} from "./KVGenerated/ExecSpecTypes.js";
import type { KVSpecificationImplementation } from "./KVGenerated/ExecSpecImplementation.js";

export class KVStore implements KVSpecificationImplementation {
  private readonly values = new Map<string, string>();

  public kvPut(input: PutRequest): ExecSpecUnit {
    this.values.set(input.key, input.value);
    return undefined;
  }

  public kvGet(input: GetRequest): GetResult {
    const value = this.values.get(input.key);
    return value === undefined ? { kind: "missing" } : { kind: "found", value };
  }

  public kvDelete(input: DeleteRequest): ExecSpecUnit {
    this.values.delete(input.key);
    return undefined;
  }

  public kvList(_input: ExecSpecUnit): KeyList {
    // Ascending Unicode scalar order - UTF-8 byte order, exactly like
    // the Swift implementation.
    const keys = [...this.values.keys()].sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    );
    return { keys };
  }

  public kvEchoRevision(input: RevisionRequest): RevisionResult {
    return { revision: input.revision };
  }

  public kvEchoTypes(input: TypesRequest): TypesResult {
    return {
      blob: input.blob,
      counts: input.counts,
      labels: input.labels,
      weight: input.weight,
    };
  }
}

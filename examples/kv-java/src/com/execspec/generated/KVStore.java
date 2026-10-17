package com.execspec.generated;

import com.execspec.runtime.*;
import java.util.*;

public final class KVStore implements KVSpecificationImplementation {
    private final Map<String, String> values = new LinkedHashMap<>();

    @Override
    public Unit kvDelete(DeleteRequest input) {
        values.remove(input.getKey());
        return Unit.INSTANCE;
    }

    @Override
    public RevisionResult kvEchoRevision(RevisionRequest input) {
        return new RevisionResult(input.getRevision());
    }

    @Override
    public TypesResult kvEchoTypes(TypesRequest input) {
        return new TypesResult(input.getBlob(), input.getCounts(), input.getLabels(), input.getWeight());
    }

    @Override
    public GetResult kvGet(GetRequest input) {
        String value = values.get(input.getKey());
        if (value == null) return GetResult.Missing.INSTANCE;
        return new GetResult.Found(value);
    }

    @Override
    public KeyList kvList(Unit input) {
        List<String> keys = new ArrayList<>(values.keySet());
        keys.sort((a, b) -> compareUtf8(a, b));
        return new KeyList(keys);
    }

    @Override
    public Unit kvPut(PutRequest input) {
        values.put(input.getKey(), input.getValue());
        return Unit.INSTANCE;
    }

    private static int compareUtf8(String a, String b) {
        byte[] ab = a.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        byte[] bb = b.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        int len = Math.min(ab.length, bb.length);
        for (int i = 0; i < len; i++) {
            if (ab[i] != bb[i]) return (ab[i] & 0xFF) - (bb[i] & 0xFF);
        }
        return ab.length - bb.length;
    }
}

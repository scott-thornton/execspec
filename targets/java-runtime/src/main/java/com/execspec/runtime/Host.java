package com.execspec.runtime;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** NDJSON host runtime: strict protocol v1 over stdin/stdout. */
public final class Host {
    public static final int PROTOCOL_VERSION = 1;
    public static final String TARGET = "java";

    private Host() {}

    public interface Dispatcher {
        String getSpecificationDigest();
        JSONValue dispatch(String operation, JSONValue input) throws Exception;
    }

    public static void run(Dispatcher dispatcher) throws IOException {
        BufferedReader reader = new BufferedReader(
            new InputStreamReader(System.in, StandardCharsets.UTF_8), 65536);
        BufferedWriter writer = new BufferedWriter(
            new OutputStreamWriter(System.out, StandardCharsets.UTF_8), 65536);

        // --- Handshake ---
        String helloLine = reader.readLine();
        if (helloLine == null) {
            System.err.println("execspec host: EOF before hello");
            System.exit(1);
        }
        JSONValue helloRaw;
        try {
            helloRaw = JSONParser.parse(helloLine);
        } catch (Exception e) {
            System.err.println("execspec host: handshake failure: " + e.getMessage());
            System.exit(1);
            return;
        }
        if (!(helloRaw instanceof JSONValue.Obj hello)
            || !"hello".equals(strField(hello, "kind"))) {
            System.err.println("execspec host: handshake failure: expected hello");
            System.exit(1);
            return;
        }
        int version = numField(hello, "protocolVersion");
        String digest = strField(hello, "specificationDigest");
        if (version != PROTOCOL_VERSION) {
            System.err.println("execspec host: protocol version mismatch (harness " + version + ", host " + PROTOCOL_VERSION + ")");
            System.exit(1);
            return;
        }
        if (digest == null || !digest.equals(dispatcher.getSpecificationDigest())) {
            System.err.println("execspec host: specification digest mismatch");
            System.exit(1);
            return;
        }
        Map<String, JSONValue> ack = new LinkedHashMap<>();
        ack.put("kind", JSONValue.str("helloAck"));
        ack.put("protocolVersion", new JSONValue.Num(String.valueOf(PROTOCOL_VERSION)));
        ack.put("specificationDigest", JSONValue.str(dispatcher.getSpecificationDigest()));
        ack.put("target", JSONValue.str(TARGET));
        writeLine(writer, JSONValue.obj(ack));

        // --- Sequential request loop ---
        while (true) {
            String line = reader.readLine();
            if (line == null) {
                System.exit(0);
            }
            JSONValue raw;
            try {
                raw = JSONParser.parse(line);
            } catch (Exception e) {
                writeFailure(writer, "", "protocolViolation", e.getMessage());
                continue;
            }
            if (!(raw instanceof JSONValue.Obj req)
                || !"request".equals(strField(req, "kind"))
                || strField(req, "id") == null
                || strField(req, "operation") == null) {
                writeFailure(writer, "", "protocolViolation", "malformed request");
                continue;
            }
            String id = strField(req, "id");
            String operation = strField(req, "operation");
            JSONValue input = req.entries().get("input");
            if (input == null) {
                writeFailure(writer, id, "protocolViolation", "missing input");
                continue;
            }
            try {
                JSONValue output = dispatcher.dispatch(operation, input);
                Map<String, JSONValue> response = new LinkedHashMap<>();
                response.put("kind", JSONValue.str("response"));
                response.put("id", JSONValue.str(id));
                response.put("output", output);
                writeLine(writer, JSONValue.obj(response));
            } catch (Exception e) {
                String category = e instanceof HostFailure hf ? hf.category : "implementationException";
                writeFailure(writer, id, category, e.getMessage());
            }
        }
    }

    public static class HostFailure extends RuntimeException {
        public final String category;
        public HostFailure(String category, String message) {
            super(message);
            this.category = category;
        }
    }

    private static String strField(JSONValue.Obj obj, String key) {
        JSONValue v = obj.entries().get(key);
        return v instanceof JSONValue.Str s ? s.value() : null;
    }

    private static int numField(JSONValue.Obj obj, String key) {
        JSONValue v = obj.entries().get(key);
        return v instanceof JSONValue.Num n ? Integer.parseInt(n.spelling()) : -1;
    }

    private static void writeLine(BufferedWriter writer, JSONValue value) throws IOException {
        writer.write(JSONSerializer.serialize(value));
        writer.write('\n');
        writer.flush();
    }

    private static void writeFailure(BufferedWriter writer, String id, String category, String message) {
        try {
            Map<String, JSONValue> failure = new LinkedHashMap<>();
            failure.put("kind", JSONValue.str("failure"));
            failure.put("id", JSONValue.str(id));
            failure.put("category", JSONValue.str(category));
            failure.put("message", JSONValue.str(message == null ? "unknown" : message));
            writeLine(writer, JSONValue.obj(failure));
        } catch (IOException e) {
            // stdout gone
        }
    }
}

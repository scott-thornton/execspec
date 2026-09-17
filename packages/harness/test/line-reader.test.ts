import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";

import { LineReader, LineReaderError } from "../src/line-reader.js";

test("reassembles messages split across chunks including UTF-8 boundaries", async () => {
  const stream = new PassThrough();
  const reader = new LineReader(stream);
  const emoji = Buffer.from("😀", "utf8");
  stream.write(Buffer.concat([Buffer.from('{"a":"'), emoji.subarray(0, 2)]));
  stream.write(Buffer.concat([emoji.subarray(2), Buffer.from('"}\n')]));
  stream.write(Buffer.from('{"b":2}\n'));
  stream.end();
  assert.equal(await reader.next(), '{"a":"😀"}');
  assert.equal(await reader.next(), '{"b":2}');
  assert.equal(await reader.next(), null);
});

test("multiple messages in one chunk", async () => {
  const stream = new PassThrough();
  const reader = new LineReader(stream);
  stream.write(Buffer.from("one\ntwo\nthree\n"));
  stream.end();
  assert.equal(await reader.next(), "one");
  assert.equal(await reader.next(), "two");
  assert.equal(await reader.next(), "three");
  assert.equal(await reader.next(), null);
});

test("strips exactly one terminal LF and optional preceding CR", async () => {
  const stream = new PassThrough();
  const reader = new LineReader(stream);
  stream.write(Buffer.from("line\r\nother\n\n"));
  stream.end();
  assert.equal(await reader.next(), "line");
  assert.equal(await reader.next(), "other");
  assert.equal(await reader.next(), "");
  assert.equal(await reader.next(), null);
});

test("rejects invalid UTF-8 lines", async () => {
  const stream = new PassThrough();
  const reader = new LineReader(stream);
  stream.write(Buffer.from([0xff, 0xfe, 0x0a]));
  await assert.rejects(() => reader.next(), (error: Error) => {
    assert.ok(error instanceof LineReaderError);
    assert.equal((error as LineReaderError).kind, "invalidUTF8");
    return true;
  });
});

test("rejects lines above the limit", async () => {
  const stream = new PassThrough();
  const reader = new LineReader(stream, 16);
  stream.write(Buffer.from("a".repeat(17)));
  await assert.rejects(() => reader.next(), (error: Error) => {
    assert.ok(error instanceof LineReaderError);
    assert.equal((error as LineReaderError).kind, "lineTooLong");
    return true;
  });
});

test("rejects full-size 16 MiB+1 lines", async () => {
  const stream = new PassThrough();
  const reader = new LineReader(stream);
  const big = "a".repeat(16 * 1024 * 1024 + 1);
  stream.write(big);
  stream.write("\n");
  await assert.rejects(() => reader.next(), (error: Error) => {
    assert.ok(error instanceof LineReaderError);
    assert.equal((error as LineReaderError).kind, "lineTooLong");
    return true;
  });
});

test("trailing partial line at EOF is a protocol failure", async () => {
  const stream = new PassThrough();
  const reader = new LineReader(stream);
  stream.write(Buffer.from("{\"kind\":"));
  stream.end();
  await assert.rejects(() => reader.next(), (error: Error) => {
    assert.ok(error instanceof LineReaderError);
    assert.equal((error as LineReaderError).kind, "partialLineAtEOF");
    return true;
  });
});

import { afterAll, describe, expect, mock, test } from "bun:test";
import { buildMetadataFileDeleteFilter, buildSessionDeleteFilter, ConversationDB } from "../src/db.ts";
import fs from "fs";
import os from "os";
import path from "path";
import * as lancedb from "@lancedb/lancedb";

describe("buildSessionDeleteFilter", () => {
  test("builds a filter for plain session ids", () => {
    expect(buildSessionDeleteFilter("session-123")).toBe(`"sessionId" = 'session-123'`);
  });

  test("escapes single quotes in session ids", () => {
    expect(buildSessionDeleteFilter("abc'def")).toBe(`"sessionId" = 'abc''def'`);
  });

  test("escapes multiple single quotes in session ids", () => {
    expect(buildSessionDeleteFilter("a'b''c")).toBe(`"sessionId" = 'a''b''''c'`);
  });
});

describe("getStatus", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clancey-test-"));
  const dbPath = path.join(tmpDir, "test.lance");

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns zeros when table does not exist", async () => {
    const db = new ConversationDB(dbPath);
    await db.init();
    const status = await db.getStatus();
    expect(status).toEqual({
      totalChunks: 0,
      projects: 0,
      lastUpdated: null,
    });
  });

  test("returns correct counts and latest timestamp", async () => {
    const conn = await lancedb.connect(dbPath);
    const dim = 384;
    const records = [
      { id: "1", sessionId: "s1", project: "proj-a", content: "hello", timestamp: "2026-01-01T00:00:00Z", chunkIndex: 0, vector: new Array(dim).fill(0) },
      { id: "2", sessionId: "s2", project: "proj-a", content: "world", timestamp: "2026-02-01T00:00:00Z", chunkIndex: 0, vector: new Array(dim).fill(0) },
      { id: "3", sessionId: "s3", project: "proj-b", content: "test", timestamp: "2026-03-01T00:00:00Z", chunkIndex: 0, vector: new Array(dim).fill(0) },
    ];
    await conn.createTable("conversations", records, { mode: "overwrite" });

    const db = new ConversationDB(dbPath);
    await db.init();
    const status = await db.getStatus();

    expect(status.totalChunks).toBe(3);
    expect(status.projects).toBe(2);
    expect(status.lastUpdated).toBe("2026-03-01T00:00:00Z");
  });
});

describe("buildMetadataFileDeleteFilter", () => {
  test("escapes single quotes in file paths", () => {
    expect(buildMetadataFileDeleteFilter("/tmp/a'b.jsonl")).toBe(`"filePath" = '/tmp/a''b.jsonl'`);
  });
});

describe("saveIndexedFile", () => {
  test("updates metadata for one file without clearing the whole table", async () => {
    const deleteMock = mock(async (_filter: string) => {});
    const addMock = mock(async (_records: unknown[]) => {});
    const tableNamesMock = mock(async () => ["metadata"]);
    const openTableMock = mock(async (_tableName: string) => ({
      delete: deleteMock,
      add: addMock,
    }));

    const db = new ConversationDB("/tmp/clancey-test.lance") as unknown as {
      db: { tableNames: typeof tableNamesMock; openTable: typeof openTableMock };
      saveIndexedFile: (filePath: string, lastModified: number) => Promise<void>;
    };

    db.db = {
      tableNames: tableNamesMock,
      openTable: openTableMock,
    };

    await db.saveIndexedFile("/tmp/a'b.jsonl", 123);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith(`"filePath" = '/tmp/a''b.jsonl'`);
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(addMock).toHaveBeenCalledWith([{ filePath: "/tmp/a'b.jsonl", lastModified: 123 }]);
  });
});

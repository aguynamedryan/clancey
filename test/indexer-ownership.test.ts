import { describe, expect, test } from "bun:test";
import { getIndexerOwnershipError } from "../src/indexer-ownership.ts";

describe("getIndexerOwnershipError", () => {
  test("allows indexing when this process owns the indexer lock", () => {
    expect(getIndexerOwnershipError(true)).toBeNull();
  });

  test("rejects indexing when this process is search-only", () => {
    expect(getIndexerOwnershipError(false)).toBe(
      "This instance is search-only; another instance owns indexing."
    );
  });
});

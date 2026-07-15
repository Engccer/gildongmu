import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("catalog byte-mirror", () => {
  it("cli와 mcp의 카탈로그가 byte 동일", () => {
    const root = join(__dirname, "..", "..", "..");
    const hash = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    expect(hash(join(root, "mcp", "src", "endpoint-catalog-shared.ts")))
      .toBe(hash(join(root, "cli", "src", "lib", "endpoint-catalog-shared.ts")));
  });
});

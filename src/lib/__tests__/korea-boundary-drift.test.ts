import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 국경 폴리곤은 한 벌이다 — 웹 정본과 Kit 리소스는 **바이트 동일 사본**이고,
 * walk seed는 자기 링을 들지 않는다(E19, spec 2026-08-23-coverage-boundary-polygon-design.md).
 * 링이 두 파일에 있으면 한쪽만 갱신되는 드리프트가 "walk만 제공 지역 밖"이라는
 * 조용한 갈림이 된다.
 */
const ROOT = join(__dirname, "../../..");
const WEB = join(ROOT, "src/lib/data/korea-boundary.json");
const KIT = join(ROOT, "ios/GildongmuKit/Sources/GildongmuKit/Resources/korea-boundary.json");

describe("국경 폴리곤 웹 ↔ Kit 사본", () => {
  it("두 파일은 바이트 동일이다", () => {
    expect(readFileSync(KIT)).toEqual(readFileSync(WEB));
  });

  it("링은 넷이고 전부 닫혀 있다", () => {
    const { rings } = JSON.parse(readFileSync(WEB, "utf8")) as {
      rings: Array<Array<[number, number]>>;
    };
    expect(rings).toHaveLength(4);
    for (const ring of rings) expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("walk seed는 더 이상 자기 링을 들지 않는다", () => {
    const seed = JSON.parse(
      readFileSync(join(ROOT, "src/lib/data/osm-walk-nodes.json"), "utf8"),
    ) as { boundary?: unknown };
    expect(seed.boundary).toBeUndefined();
  });
});

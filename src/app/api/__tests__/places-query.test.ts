import { describe, expect, it } from "vitest";
import { parsePlacesQuery } from "../places/query-schema";

const q = (s: string) => new URLSearchParams(s);

describe("/api/places 쿼리 — sort 축(spec 2026-08-17 §3.2)", () => {
  it("기본값은 accuracy(기존 요청과 동일)", () => {
    const r = parsePlacesQuery(q("query=길동"));
    expect(r.ok && r.data.sort).toBe("accuracy");
  });
  it("sort=review 허용", () => {
    const r = parsePlacesQuery(q("query=길동&sort=review"));
    expect(r.ok && r.data.sort).toBe("review");
  });
  it("무효 sort는 400(조용한 무시 금지)", () => {
    expect(parsePlacesQuery(q("query=길동&sort=rating")).ok).toBe(false);
  });
  it("리뷰순에서도 좌표는 파싱된다(표기 전용, 검색엔 안 쓰임)", () => {
    const r = parsePlacesQuery(q("query=길동&sort=review&lat=37.5&lng=127.1"));
    expect(r.ok && r.data.lat).toBe(37.5);
    expect(r.ok && r.data.lng).toBe(127.1);
  });
  it("빈 좌표는 400이 아니라 좌표 없음", () => {
    const r = parsePlacesQuery(q("query=길동&lat=&lng="));
    expect(r.ok && r.data.lat).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 리뷰순 정렬 축 웹↔Kit 드리프트 가드(spec 2026-08-17-naver-review-sort §7).
 *
 * 세 벌이 한 문자열 계약("review")을 공유한다: 웹 렌더 타입, Kit 렌더 디코더, Kit 검색
 * 쿼리. 어느 한 곳이 이름을 바꾸면 iOS 헤딩이 조용히 "장소 N곳"으로 되돌아가거나(디코더)
 * 서버가 400을 낸다(쿼리) — 둘 다 오류가 아니라 침묵이라 소스 스캔으로 잡는다.
 */
const WEB_TYPES = "src/lib/chat/types.ts";
const KIT_CHAT = "ios/GildongmuKit/Sources/GildongmuKit/Models/ChatModels.swift";
const KIT_SEARCH = "ios/GildongmuKit/Sources/GildongmuKit/SearchService.swift";
const WEB_ROUTE = "src/app/api/places/query-schema.ts";

describe("리뷰순 sort 계약 드리프트", () => {
  it("웹 렌더 타입은 places에 sort?: \"review\"를 싣는다", () => {
    expect(readFileSync(WEB_TYPES, "utf8")).toMatch(/type: "places"; places: Place\[\]; sort\?: "review"/);
  });
  it("Kit 렌더 디코더는 sort 키의 \"review\"를 .review로 읽는다(아니면 iOS 헤딩이 갈리지 않는다)", () => {
    const src = readFileSync(KIT_CHAT, "utf8");
    expect(src).toMatch(/case type, places, results, sort/);
    expect(src).toMatch(/forKey: \.sort\) == "review"/);
  });
  it("Kit 검색은 sort=review 쿼리를 보내고, 웹 라우트는 그 값을 받는다", () => {
    expect(readFileSync(KIT_SEARCH, "utf8")).toMatch(/URLQueryItem\(name: "sort", value: "review"\)/);
    expect(readFileSync(WEB_ROUTE, "utf8")).toMatch(/z\.enum\(\["accuracy", "review"\]\)/);
  });
});

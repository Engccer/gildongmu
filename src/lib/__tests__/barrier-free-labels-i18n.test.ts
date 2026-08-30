import { describe, expect, it } from "vitest";
import ko from "../../../messages/ko.json";
import { BARRIER_FREE_FIELD_KEYS } from "../barrier-free-fields";
import { BARRIER_FREE_FIELD_LABELS } from "../providers/tour-barrier-free";

/**
 * 무장애 라벨 3자 동조(A26): provider 화이트리스트(서버 한글 라벨) == 공유 키 목록 == ko i18n.
 * 한쪽만 늘리면 웹은 서버 라벨 폴백으로 조용히 한글이 새고, iOS는 키 문자열이 낭독된다.
 * 다른 로케일의 키 집합은 `i18n-messages.test.ts`가 ko와 대조한다.
 */
describe("무장애 편의시설 라벨 키 동조", () => {
  it("provider 라벨 표의 키 == 공유 키 목록(순서 포함)", () => {
    expect(Object.keys(BARRIER_FREE_FIELD_LABELS)).toEqual([...BARRIER_FREE_FIELD_KEYS]);
  });

  it("ko i18n 라벨 == 서버 한글 라벨(ko 화면 byte-동일)", () => {
    expect(ko.barrierFreeInfo.facility).toEqual(BARRIER_FREE_FIELD_LABELS);
  });
});

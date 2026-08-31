import Foundation

// 카카오 분류 표시 선택(A28) — 웹 `src/lib/kakao-category.ts` `pickCategory` 미러. 규칙은 공유 fixture
// `src/lib/__tests__/fixtures/kakao-category-pick-cases.json`이 못 박는다(`KakaoCategoryTests`).
// spec `docs/superpowers/specs/2026-08-31-kakao-category-en-design.md` §5·§7.
//
// 영문 경로는 서버가 세그먼트 **전부** 등재일 때만 싣는다(부분 번역 혼합 없음). 여기서는 "무엇을 보일까"만
// 정한다: 비-ko(데이터 로케일 en)는 `categoryEn` 우선, 부재·빈 문자열이면 원문. ko는 항상 원문.
// ⚠ 판정 축(`isStation`·`categoryOf`·채팅 컨텍스트)은 원문 `category`를 읽는다 — 이 함수를 그 자리에 쓰지 말 것.
public func pickCategory(lang: String, category: String, categoryEn: String?) -> String {
    guard lang != "ko", let en = categoryEn, !en.isEmpty else { return category }
    return en
}

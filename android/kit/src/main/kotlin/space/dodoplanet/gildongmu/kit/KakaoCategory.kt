package space.dodoplanet.gildongmu.kit

/**
 * 카카오 분류 표시 선택(A28) — 웹 `src/lib/kakao-category.ts` `pickCategory` ↔ Kit
 * `KakaoCategory.swift` 미러. 규칙은 공유 fixture `kakao-category-pick-cases.json`이 못 박는다.
 *
 * 비-ko는 `categoryEn` 우선, 부재·빈 문자열이면 원문. ko는 항상 원문.
 * ⚠ 판정 축(`isStation`·`categoryOf`)은 원문 `category`를 읽는다 — 이 함수를 그 자리에 쓰지 말 것.
 */
fun pickCategory(lang: String, category: String, categoryEn: String?): String {
    if (lang == "ko" || categoryEn.isNullOrEmpty()) return category
    return categoryEn
}

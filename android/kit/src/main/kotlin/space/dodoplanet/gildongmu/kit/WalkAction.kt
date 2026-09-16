package space.dodoplanet.gildongmu.kit

/**
 * 결정 지점 행동(웹 `WalkAction` ↔ Kit `WalkAction.swift` 미러). 값은 **서버가 투영한다**:
 * 도보는 `WalkRouteStep.action`, 자동차는 `CarAction`(turnType 표). :kit은 문장을 분류하지
 * 않는다 — **미투영의 결과는 오안내가 아니라 침묵**이다.
 *
 * 엔트리 이름은 Swift raw 값과 같다(직렬화 문자열이자 fixture 표기). 미지 문자열은 디코딩
 * 실패가 아니라 `null`이어야 하므로 모델은 `fromRawValue`를 거친다.
 *
 * `imminentTone(action)`은 여기 있지 않다: 소리 열거형 `GuideTone`이 `RouteGuide.swift`에
 * 있어 GUIDE 그룹이 `RouteGuide.kt`와 함께 싣는다(등록부 foundation.json 참조).
 */
enum class WalkAction {
    left, right, back, crosswalk, underpass,

    /** 자동차 갈래 선택 — 서버 `turnType` 투영(`CarAction`)으로만 들어온다. */
    keepLeft, keepRight;

    val rawValue: String get() = name

    companion object {
        fun fromRawValue(raw: String): WalkAction? = entries.firstOrNull { it.name == raw }
    }
}

/** 수단 중립 별칭(웹 `GuideAction` 미러). */
typealias GuideAction = WalkAction

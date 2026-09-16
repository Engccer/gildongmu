package space.dodoplanet.gildongmu.kit

/**
 * 채팅 응답 듣기 속도(1/1.5/2배) 순수 규칙 — Kit `ListenSpeed.swift` 부분 미러(dodo-planet `TtsRules` 속도 절 이식).
 * gildongmu는 요약 자동 듣기가 없어 속도 값을 하나만 둔다.
 *
 * 사용자 설정 정규화만 옮긴다. iOS의 `baseSpeechRate`·`speechRate(forMultiplier:)`는 `AVSpeechUtterance.rate` 축을
 * 실측한 표라 이식하지 않는다(D10) — 안드로이드 `TextToSpeech.setSpeechRate`는 배율 축이라 그 값을 넘기면 틀린다.
 * 배율 → 엔진 값 매핑은 [3] `:app`이 실기기 실측으로 정한다.
 */
object ListenSpeed {
    /** 설정 픽커가 노출하는 허용 배속. */
    val allowedSpeeds: List<Double> = listOf(1.0, 1.5, 2.0)

    /** 설정 저장 공유 키. 무인증 앱이라 기기 로컬 저장이 정본이다. */
    const val storageKey = "listenSpeed"

    /** 허용값(1/1.5/2) 외의 값(미설정·이상값)은 1로 정규화한다(dodo `normalizeSpeed` 동일 계약). */
    fun normalizeSpeed(value: Double?): Double {
        if (value == null || value !in allowedSpeeds) return 1.0
        return value
    }
}

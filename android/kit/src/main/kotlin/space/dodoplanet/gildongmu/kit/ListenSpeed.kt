package space.dodoplanet.gildongmu.kit

/**
 * 채팅 응답 듣기 속도(1/1.5/2배) 순수 규칙 — Kit `ListenSpeed.swift` 미러(dodo-planet `TtsRules` 속도 절 이식).
 * 재생 계층과 분리해 단위 테스트만으로 검증한다. gildongmu는 요약 자동 듣기가 없어 속도 값을 하나만 둔다.
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

    /**
     * 온디바이스 낭독 기준 속도(배속 1일 때 값) — iOS `AVSpeechUtterance.rate` 축의 값이다(시스템 기본 0.5보다
     * 약간 빠르게, 위원장 선호 2026-07-27).
     */
    const val baseSpeechRate: Float = 0.55f

    /**
     * iOS `AVSpeechUtterance.rate` 축의 3점 캘리브레이션 표(곱셈 매핑 아님 — 그 축은 비선형이라 곱셈이
     * 1.5배·2배를 상한 근처로 몰아 청감상 구분되지 않았다, dodo 3a4d72eb 실측).
     *
     * ⚠ **이 표는 AVSpeechSynthesizer의 rate 곡선을 실측한 값이다.** 안드로이드 `TextToSpeech.setSpeechRate`는
     * 1.0이 표준 속도인 다른 축이라 이 값을 그대로 넘기면 안 된다 — [3] `:app`은 배율(`normalizeSpeed` 결과)을
     * 받아 자기 엔진에서 실측한 매핑을 쓴다(D10 "오디오는 번역하지 않는다"). 미러 동조를 위해 판정 그대로 둔다.
     */
    fun speechRate(multiplier: Double): Float = when (multiplier) {
        1.5 -> 0.65f
        2.0 -> 0.75f
        else -> baseSpeechRate
    }
}

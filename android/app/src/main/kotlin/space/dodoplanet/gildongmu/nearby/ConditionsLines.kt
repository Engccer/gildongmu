package space.dodoplanet.gildongmu.nearby

import space.dodoplanet.gildongmu.kit.models.AirPollutant

// 날씨·공기질·혼잡도 문장(iOS `ConditionsView.swift` 이식, spec §12-1). 등급·상태 낱말이 낭독 정본이고 수치는 보강.

/** 완료 통지 3분기 — 이번 호출의 두 결과(`fresh*`)로만 판정(병합된 값 검사 금지). 혼잡도는 부재가 정상이라 판정에 넣지 않는다. */
fun conditionsNotice(p: ConditionsPayload, ready: String, partial: String, failed: String): String = when {
    p.freshWeather && p.freshAir -> ready
    p.freshWeather || p.freshAir -> partial
    else -> failed
}

/** 정수값은 소수점 제거("31.0도" 방지), 소수는 그대로("24.2도"·"0.3km"). */
fun numberText(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

/** 등급 낱말(낭독 정본) + 수치(보강, value 있으면 괄호로). */
fun pollutantText(label: String, pollutant: AirPollutant, grade: (String) -> String): String {
    val g = grade(pollutant.grade)
    val v = pollutant.value ?: return "$label, $g"
    return "$label, $g (${numberText(v)})"
}

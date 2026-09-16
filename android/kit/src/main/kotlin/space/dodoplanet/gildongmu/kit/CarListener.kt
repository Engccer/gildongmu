package space.dodoplanet.gildongmu.kit

/**
 * 자동차 안내 청취자(K2 spec §6.1, 위원장 판정 ②). 세션 시작 시 읽어 세션에 고정한다. Kit `CarListener.swift` 미러.
 *
 * - `passenger`(기본): 내가 이어폰으로 듣는다 — 스크린 리더 통지·햅틱, 도보 문형 계승(`GuideTuning.car`).
 * - `driver`: 운전하는 가족이 스피커로 듣는다 — TTS 음성 채널, 짧은 명령형, 낮은 빈도(`GuideTuning.carDriver`,
 *   임박 8초). 주기·상태 통지는 내지 않는다(오케스트레이터가 거른다).
 */
enum class CarListener {
    passenger,
    driver;

    val rawValue: String get() = name

    companion object {
        const val storageKey = "carListener"
        val default: CarListener = passenger

        fun fromRawValue(raw: String): CarListener? = entries.firstOrNull { it.name == raw }
    }
}

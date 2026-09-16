package space.dodoplanet.gildongmu.a11y

/** 결과 진동 종류(iOS `ResultHaptic` 3종 미러, spec §14-3 판정 40) — 3-state를 촉각에도: 성공·주의(0건)·실패. */
enum class HapticKind { success, attention, failure }

/**
 * 단일 polite 통지 슬롯. 같은 문장이라도 `seq`가 바뀌면 `StatusLine`이 한 프레임 비웠다 다시 써서 발화한다(spec §3-4).
 * `haptic`은 1회성 결과에만(진행·반복 상태 통지는 null) — 문장이 나가는 조건 = 진동이 나가는 조건(`StatusLine` 발화 효과 안).
 */
data class Notice(
    val seq: Int,
    val text: String,
    /** 낭독형(거리 단위 풀어쓰기 등). 시각 텍스트는 `text` 원문 유지. null이면 같다. */
    val spoken: String? = null,
    val haptic: HapticKind? = null,
)

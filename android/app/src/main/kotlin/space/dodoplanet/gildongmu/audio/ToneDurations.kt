package space.dodoplanet.gildongmu.audio

import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.LeftRightToneScheme

/**
 * 톤 길이 정본 = 상수 표(spec §5-1, ffprobe 2026-09-16). 런타임 측정은 두지 않는다 — mp3 메타데이터 길이는 근사라 발화가 톤
 * 꼬리와 겹칠 수 있다. `ToneDurationsTest`가 `res/raw` mp3의 프레임 헤더를 세어 이 표와 ±0.05초로 대조한다(소리 파일을
 * 갈면 표가 빨개진다). `speechDeferThresholdSeconds` 0.6 선이 표를 정확히 가른다.
 */
object ToneDurations {
    fun seconds(tone: BeaconTone, @Suppress("UNUSED_PARAMETER") scheme: LeftRightToneScheme): Double = when (tone) {
        BeaconTone.closer -> 0.20
        BeaconTone.farther -> 0.20
        BeaconTone.nearby -> 2.20
        BeaconTone.tick -> 0.48
        BeaconTone.start -> 1.30
        BeaconTone.stop -> 1.30
        BeaconTone.ahead -> 0.68
        BeaconTone.crosswalk -> 1.09
        BeaconTone.left -> 0.40
        BeaconTone.right -> 0.40
        BeaconTone.back -> 0.90
        BeaconTone.warning -> 0.80
        BeaconTone.unreliable -> 0.42
    }
}

/**
 * 톤 → `res/raw` 리소스(spec §5-1 이름 규칙: 웹 `<이름>.mp3` ↔ iOS `guide-<이름>.mp3` ↔ 안드로이드 `guide_<이름 with - → _>.mp3`).
 * `BeaconTone.resourceName(scheme)`의 `-` → `_`가 곧 이름이다. 소스 가드가 파일 집합·바이트 동일을 웹 파일과 대조한다.
 */
fun toneResource(tone: BeaconTone, scheme: LeftRightToneScheme): Int = when (tone) {
    BeaconTone.closer -> R.raw.guide_closer
    BeaconTone.farther -> R.raw.guide_farther
    BeaconTone.nearby -> R.raw.guide_nearby
    BeaconTone.tick -> R.raw.guide_tick
    BeaconTone.start -> R.raw.guide_start
    BeaconTone.stop -> R.raw.guide_stop
    BeaconTone.ahead -> R.raw.guide_ahead
    BeaconTone.crosswalk -> R.raw.guide_crosswalk
    BeaconTone.left -> when (scheme) { LeftRightToneScheme.pan -> R.raw.guide_left_pan; LeftRightToneScheme.pitch -> R.raw.guide_left_pitch }
    BeaconTone.right -> when (scheme) { LeftRightToneScheme.pan -> R.raw.guide_right_pan; LeftRightToneScheme.pitch -> R.raw.guide_right_pitch }
    BeaconTone.back -> R.raw.guide_back
    BeaconTone.warning -> R.raw.guide_warning
    BeaconTone.unreliable -> R.raw.guide_unreliable
}

/** 게인 표(iOS `gains`·웹 `useBeaconSound` GAIN 미러): 추세음 낮게(보행 내내 반복)·이벤트음 원음. `unreliable`은 `tick`보다 높다. */
fun toneGain(tone: BeaconTone): Float = when (tone) {
    BeaconTone.closer, BeaconTone.farther -> 0.35f
    BeaconTone.nearby, BeaconTone.warning -> 1f
    BeaconTone.tick -> 0.3f
    BeaconTone.start, BeaconTone.stop, BeaconTone.ahead, BeaconTone.crosswalk, BeaconTone.left, BeaconTone.right, BeaconTone.back -> 0.8f
    BeaconTone.unreliable -> 0.45f
}

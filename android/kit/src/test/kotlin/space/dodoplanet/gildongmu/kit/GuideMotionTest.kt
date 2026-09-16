package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals

/** 3-state 정지 판정 — Kit `GuideMotionTests` 미러. */
class GuideMotionTest {
    private fun sample(at: Double, lat: Double = 37.5, lng: Double = 127.0, acc: Double = 10.0) = MotionSample(lat, lng, acc, at)

    private fun step(state: MotionJudgeState, s: MotionSample, speed: Double?, speedAccuracy: Double?) =
        motionStep(state, s, speed, speedAccuracy, maxSpeedMps = 8.0)

    // ── 도플러 신뢰 조건 ──

    @Test fun `도플러 속도가 신뢰 조건을 만족하면 그 값을 쓴다`() {
        assertEquals(MotionState.moving, step(MotionJudgeState.initial, sample(0.0), 1.5, 0.5).motion)
    }

    @Test fun `speedAccuracy가 상한을 넘으면 그 speed는 근거가 못 된다`() {
        assertEquals(MotionState.speedUnknown, step(MotionJudgeState.initial, sample(0.0), 0.2, 5.0).motion)
    }

    @Test fun `음수 speed는 무효 신호다`() {
        assertEquals(MotionState.speedUnknown, step(MotionJudgeState.initial, sample(0.0), -1.0, 0.5).motion)
    }

    /** 정확도는 3-state다. null은 "플랫폼이 그 축을 제공하지 않음"이지 "정확도가 나쁨"이 아니다. */
    @Test fun `speedAccuracy가 null이면 플랫폼 미제공이라 speed를 채택한다`() {
        assertEquals(MotionState.moving, step(MotionJudgeState.initial, sample(0.0), 1.5, null).motion)
    }

    @Test fun `speedAccuracy가 null이어도 느린 speed는 정지로 간다`() {
        var state = MotionJudgeState.initial
        for (t in listOf(0.0, 1.0)) state = step(state, sample(t), 0.1, null).state
        assertEquals(MotionState.stopped, step(state, sample(2.5), 0.1, null).motion)
    }

    // ── 히스테리시스 ──

    @Test fun `정지 진입은 유지 시간을 채워야 성립한다`() {
        var out = step(MotionJudgeState.initial, sample(0.0), 0.1, 0.3)
        assertEquals(MotionState.moving, out.motion) // 아직 2초를 못 채웠다
        out = step(out.state, sample(1.5), 0.1, 0.3)
        assertEquals(MotionState.moving, out.motion)
        assertEquals(MotionState.stopped, step(out.state, sample(2.1), 0.1, 0.3).motion)
    }

    @Test fun `이탈은 즉시다 — 비대칭이 의도`() {
        var state = MotionJudgeState.initial
        for (t in listOf(0.0, 2.5)) state = step(state, sample(t), 0.1, 0.3).state
        assertEquals(MotionState.moving, step(state, sample(3.0), 0.7, 0.3).motion)
    }

    @Test fun `히스테리시스 구간 0점4~0점6에서는 정지를 유지한다`() {
        var state = MotionJudgeState.initial
        for (t in listOf(0.0, 2.5)) state = step(state, sample(t), 0.1, 0.3).state
        assertEquals(MotionState.stopped, step(state, sample(3.0), 0.5, 0.3).motion)
    }

    @Test fun `느린 보행 0점7m·s는 정지가 아니다`() {
        var state = MotionJudgeState.initial
        for (t in listOf(0.0, 1.0, 2.0, 3.0, 4.0)) {
            val out = step(state, sample(t), 0.7, 0.3)
            state = out.state
            assertEquals(MotionState.moving, out.motion, "t=$t")
        }
    }

    // ── 거리 미분 폴백 ──

    @Test fun `도플러가 없으면 거리 미분 폴백을 쓴다`() {
        val state = step(MotionJudgeState.initial, sample(0.0, lat = 37.5), null, null).state
        // 약 22m를 2초 = 11m/s → 물리 상한(8) 초과라 폐기.
        assertEquals(MotionState.speedUnknown, step(state, sample(2.0, lat = 37.5002), null, null).motion)
        // 약 2.2m를 2초 = 1.1m/s → 유효.
        assertEquals(MotionState.moving, step(state, sample(2.0, lat = 37.50002), null, null).motion)
    }

    @Test fun `폴백은 간격이 너무 짧거나 길면 쓰지 않는다`() {
        val state = step(MotionJudgeState.initial, sample(0.0), null, null).state
        assertEquals(MotionState.speedUnknown, step(state, sample(0.5, lat = 37.50002), null, null).motion)
        assertEquals(MotionState.speedUnknown, step(state, sample(7.0, lat = 37.50002), null, null).motion)
    }

    @Test fun `폴백은 두 fix 정확도가 20m를 넘으면 쓰지 않는다`() {
        val state = step(MotionJudgeState.initial, sample(0.0, acc = 35.0), null, null).state
        assertEquals(MotionState.speedUnknown, step(state, sample(2.0, lat = 37.50002, acc = 10.0), null, null).motion)
    }

    @Test fun `폴백으로도 정지를 판정할 수 있다`() {
        var state = MotionJudgeState.initial
        for (t in listOf(0.0, 1.0, 2.0, 3.0)) state = step(state, sample(t), null, null).state
        assertEquals(MotionState.stopped, step(state, sample(4.0), null, null).motion)
    }

    /** 폴백에 못 쓸 정확도의 fix가 `lastSample`을 덮으면 다음 fix까지 강제로 speedUnknown이 된다. */
    @Test fun `폴백에 못 쓸 정확도의 fix는 기준 표본을 덮지 않는다`() {
        var state = step(MotionJudgeState.initial, sample(0.0), null, null).state
        state = step(state, sample(1.0, acc = 35.0), null, null).state
        assertEquals(MotionState.moving, step(state, sample(2.0, lat = 37.50002), null, null).motion)
    }

    @Test fun `속도를 모르면 정지 계측이 초기화된다`() {
        var state = step(MotionJudgeState.initial, sample(0.0), 0.1, 0.3).state
        // 도플러 무효 + 폴백 간격 미달(0.5초)이라 speedUnknown.
        state = step(state, sample(0.5), null, null).state
        assertEquals(MotionState.moving, step(state, sample(2.5), 0.1, 0.3).motion)
    }
}

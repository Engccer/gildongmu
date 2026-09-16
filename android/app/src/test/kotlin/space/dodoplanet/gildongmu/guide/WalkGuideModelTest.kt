package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.TestScope
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.BeaconTone
import space.dodoplanet.gildongmu.kit.HttpResponse
import space.dodoplanet.gildongmu.kit.pathOf
import space.dodoplanet.gildongmu.kit.WalkRouteVariant
import space.dodoplanet.gildongmu.kit.spokenDistanceUnits
import space.dodoplanet.gildongmu.location.LocationPermission
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** 워치독이 2초 주기 무한 루프라 `advanceUntilIdle`은 영영 끝나지 않는다 — 현재 시각의 태스크만 소진한다. */
@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

/** spec §3 시작·종료 계약 + §6-2 시작 조회. 판정은 :kit, 여기는 순서·수명·포트 호출을 잠근다. */
@OptIn(ExperimentalCoroutinesApi::class)
class WalkGuideModelTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)


    @Test fun `권한 없음 → denied 실패 + 설정 해결 + 시작 안 됨`() = guideTest(dispatcher) { h ->
        h.perms.location = LocationPermission.None
        h.perms.requestResult = LocationPermission.None
        h.model.requestStart(h.request)
        settle()
        assertEquals(GuideStatus.denied, h.model.ui.value.status)
        assertEquals(FailResolution.settings, h.model.ui.value.failResolution)
        assertEquals(h.catalog.get("beacon.denied"), h.model.ui.value.statusText)
        assertEquals(0, h.controller.starts)
        assertEquals(1, h.perms.locationRequests)
        assertFalse(h.model.ui.value.starting)
        assertEquals(listOf(h.catalog.get("beacon.denied")), h.speaker.texts)
    }

    @Test fun `COARSE → unavailable + precise 해결`() = guideTest(dispatcher) { h ->
        h.perms.location = LocationPermission.Coarse
        h.model.requestStart(h.request)
        settle()
        assertEquals(GuideStatus.unavailable, h.model.ui.value.status)
        assertEquals(FailResolution.precise, h.model.ui.value.failResolution)
        assertEquals(h.catalog.get("beacon.reduced"), h.model.ui.value.statusText)
        assertEquals(0, h.controller.starts)
    }

    @Test fun `위치 서비스 꺼짐 → unavailable weak`() = guideTest(dispatcher) { h ->
        h.perms.enabled = false
        h.model.requestStart(h.request)
        settle()
        assertEquals(GuideStatus.unavailable, h.model.ui.value.status)
        assertEquals(h.catalog.get("beacon.weak"), h.model.ui.value.statusText)
        assertEquals(FailResolution.none, h.model.ui.value.failResolution)
    }

    @Test fun `정상 시작 → tracking·서비스 start·start 톤·claim·걸음·TTS 준비`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
        assertEquals(listOf(BeaconTone.start), h.tones.played)
        assertEquals(1, h.tones.sessions)
        assertTrue(h.coordinator.isActive)
        assertEquals(1, h.controller.starts)
        assertEquals(1, h.steps.starts)
        assertEquals(1, h.speaker.prepares)
        assertEquals(1, h.perms.notificationRequests)
        assertEquals("길동역", h.model.ui.value.destinationLabel)
        assertFalse(h.model.ui.value.starting)
    }

    @Test fun `걸음 권한 거부 → 세션은 시작하되 걸음 센서는 켜지 않는다`() = guideTest(dispatcher) { h ->
        h.perms.activity = false
        h.model.requestStart(h.request)
        settle()
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
        assertEquals(0, h.steps.starts)
    }

    @Test fun `서비스 시작 실패 콜백 → serviceStartFailed 문장·unavailable·토큰 반납`() = guideTest(dispatcher) { h ->
        h.controller.failOnStart = IllegalStateException("bg")
        h.model.requestStart(h.request)
        settle()
        assertEquals(GuideStatus.unavailable, h.model.ui.value.status)
        assertEquals(h.catalog.get("android.guide.serviceStartFailed"), h.model.ui.value.statusText)
        assertFalse(h.coordinator.isActive)
        assertFalse(h.model.ui.value.starting)
        assertEquals(FailResolution.none, h.model.ui.value.failResolution)
        assertNull(h.model.ui.value.lastStartVariant)
        assertEquals(listOf(ResultHapticKind.failure), h.haptics.fired)
        // 실패 뒤 반쪽 세션이 살아나지 않는다 — 시작 톤·워치독·TTS 준비 없음.
        assertEquals(emptyList(), h.tones.played)
        assertEquals(0, h.speaker.prepares)
        // 최단 버튼에서 시작한 실패는 그 버튼 아래 행이 그려지도록 variant를 보존한다.
        h.model.clearFailure()
        h.model.requestStart(h.request.copy(variant = WalkRouteVariant.shortest))
        settle()
        assertEquals(WalkRouteVariant.shortest, h.model.ui.value.lastStartVariant)
        assertEquals(GuideStatus.unavailable, h.model.ui.value.status)
    }

    @Test fun `톤 뒤 발화 — 재생 중인 톤이 끝난 뒤 게시한다(DeferredAnnouncer 배선)`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.speaker.spoken.clear()
        h.tones.toneEndsAt = h.clock.now + 1.0   // 1초 남은 톤(FakeTones.play는 null로 되돌리므로 직접 대입)
        h.model.announceNow("즉시 창구")           // 즉시 창구는 미루지 않는다
        assertEquals(listOf("즉시 창구"), h.speaker.texts)
        h.speaker.spoken.clear()
        h.model.handleProviderDisabled()          // 자동 통지(`beacon.weak`) → 톤 잔여 1.0 + 0.15초 지연
        assertEquals(emptyList(), h.speaker.spoken)
        h.clock.now += 0.5; advanceTimeBy(500); runCurrent()
        assertEquals(emptyList(), h.speaker.spoken)
        h.clock.now += 0.7; advanceTimeBy(700); runCurrent()
        assertEquals(listOf(h.catalog.get("beacon.weak")), h.speaker.texts)
    }

    @Test fun `종료 → 토큰 반납 → 재시작 성공`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.model.stopByUser()
        assertFalse(h.coordinator.isActive)
        assertEquals(GuideStatus.idle, h.model.ui.value.status)
        assertEquals(1, h.controller.stops)
        assertEquals(listOf(BeaconTone.start, BeaconTone.stop), h.tones.played)
        assertEquals(1, h.tones.ends)
        h.model.requestStart(h.request)
        settle()
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
        assertTrue(h.coordinator.isActive)
    }

    @Test fun `다른 세션 점유 중 시작 → alreadyActive 즉시 통지·억제 우회`() = guideTest(dispatcher) { h ->
        h.coordinator.claim { }
        h.model.outputSuppressed = true
        h.model.requestStart(h.request)
        settle()
        assertEquals(GuideStatus.idle, h.model.ui.value.status)
        assertEquals(listOf(h.catalog.get("guide.alreadyActive") to true), h.speaker.spoken)
        assertEquals(0, h.controller.starts)
    }

    @Test fun `조회 대기 15초 무수용 → detailNoLocation 간략 폴백`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.clock.now += 15.5
        advanceTimeBy(16_000)
        assertEquals(h.catalog.get("guide.detailNoLocation"), h.model.ui.value.statusText)
        assertEquals(GuideMode.brief, h.model.ui.value.mode)
        assertTrue(h.speaker.texts.contains(h.catalog.get("guide.detailNoLocation")))
        assertEquals(0, h.transport.seenUrls.size)
    }

    @Test fun `대기 중 미달 fix만 오면 15초에 최선값으로 조회한다`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.walkTo(0.0, accuracy = 60.0)   // 수용(30m) 미달, 보관(100m) 가능
        h.walkTo(0.0, accuracy = 45.0)   // 더 나은 최선값
        h.clock.now += 15.0
        advanceTimeBy(16_000)
        assertEquals(1, h.transport.seenUrls.size)
        assertEquals("/api/route/walk", pathOf(h.transport.seenUrls.first()))
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
    }

    @Test fun `수용 fix → 경로 조회(includeGeometry) → 상세 모드·시작 원자 발화·잔여 행`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.walkTo(0.0)
        settle()
        val url = h.transport.seenUrls.single()
        assertEquals("/api/route/walk", pathOf(url))
        assertTrue(url.contains("includeGeometry=1"))
        assertFalse(url.contains("accessible="))
        assertEquals(GuideMode.detail, h.model.ui.value.mode)
        val expected = h.catalog.get("guide.detailStart", "길동역", 1, "300m", "천호대로를 따라 300m 이동")
        assertEquals(expected, h.model.ui.value.statusText)
        // 발화는 낭독 정정(`spokenDistanceUnits`)을 지난 문장, 화면 문장은 원문.
        assertEquals(spokenDistanceUnits(expected, "미터") to true, h.speaker.spoken.last())
        assertNotNull(h.model.ui.value.remainingText)
        assertEquals(listOf("천호대로를 따라 300m 이동"), h.model.ui.value.routeStepDescriptions)
        assertEquals(0, h.model.ui.value.currentStepIndex)
        assertEquals(300, h.model.ui.value.bandDistanceMeters)
    }

    @Test fun `계단 회피 시작 + 열화 문장 → 시작 문장 앞에 결합`() = guideTest(dispatcher, { HttpResponse(200, straightRouteJson().replace("\"steps\"", "\"stepFree\":\"unavailable\",\"stepFreeNotice\":\"계단 회피 경로를 찾지 못했습니다\",\"steps\"")) }) { h ->
        h.model.requestStart(h.request.copy(accessible = true))
        settle()
        h.walkTo(0.0)
        settle()
        assertTrue(h.transport.seenUrls.single().contains("accessible=true"))
        assertTrue(h.model.ui.value.statusText.startsWith("계단 회피 경로를 찾지 못했습니다 "))
    }

    @Test fun `경로 없음(result null) → detailUnavailable 간략 폴백(목적지 포함)`() = guideTest(dispatcher, { HttpResponse(200, "{\"result\":null}") }) { h ->
        h.model.requestStart(h.request)
        settle()
        h.walkTo(0.0)
        settle()
        assertEquals(GuideMode.brief, h.model.ui.value.mode)
        assertEquals(h.catalog.get("guide.detailUnavailable", "길동역"), h.model.ui.value.statusText)
    }

    @Test fun `조회 5xx → 간략 폴백, 세션은 계속`() = guideTest(dispatcher, { HttpResponse(502, "{}") }) { h ->
        h.model.requestStart(h.request)
        settle()
        h.walkTo(0.0)
        settle()
        assertEquals(GuideMode.brief, h.model.ui.value.mode)
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
    }

    @Test fun `사용자 중지 — 72걸음 이상이면 stopped 종료 화면·요약, 미만이면 화면 없음`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.steps.liveSample = StepSample(steps = 10, distanceMeters = null)
        h.model.stopByUser()
        assertNull(h.model.ui.value.arrivalDest)
        assertFalse(h.model.ui.value.hasScreen)

        h.model.requestStart(h.request)
        settle()
        h.steps.liveSample = StepSample(steps = 120, distanceMeters = null)
        h.model.stopByUser()
        val ui = h.model.ui.value
        assertEquals(h.dest, ui.arrivalDest)
        assertEquals(SessionEndKind.stopped, ui.endKind)
        assertEquals(h.catalog.get("android.beacon.stopped"), ui.endText)
        assertEquals(120, ui.arrivalHealth?.steps)
        assertTrue(ui.hasScreen)
        assertEquals(h.catalog.get("android.beacon.stopped") to true, h.speaker.spoken.last())
        h.model.clearArrival()
        assertFalse(h.model.ui.value.hasScreen)
    }

    @Test fun `제공자 꺼짐 → 세션 종료 + weak 실패 상태 잔존`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.model.handleProviderDisabled()
        assertEquals(GuideStatus.unavailable, h.model.ui.value.status)
        assertEquals(h.catalog.get("beacon.weak"), h.model.ui.value.statusText)
        assertFalse(h.coordinator.isActive)
        assertEquals(1, h.controller.stops)
    }

    @Test fun `음성 게이트 — 다른 앱 전경(화면 켜짐)이면 발화 보류, 화면 꺼짐이면 발화, 복귀 시 상환`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.walkTo(0.0)
        settle()  // 상세 시작 — statusText = 시작 문장
        h.env.foreground = false
        h.env.interactive = true
        h.model.setForeground(false)
        h.speaker.spoken.clear()
        h.model.announceNow("보류될 문장")
        assertEquals(emptyList(), h.speaker.spoken)
        h.env.interactive = false
        h.model.announceNow("화면 꺼짐 발화")
        assertEquals(listOf("화면 꺼짐 발화"), h.speaker.texts)
        // 복귀 상환: 보류된 시점의 문장이 아니라 **최신 statusText**가 꼬리로 나간다.
        h.env.foreground = true
        h.env.interactive = true
        h.speaker.spoken.clear()
        h.model.setForeground(true)
        assertEquals(listOf(spokenDistanceUnits(h.model.ui.value.statusText, "미터")), h.speaker.texts)
        // 갚았으니 두 번째 복귀는 조용하다.
        h.speaker.spoken.clear()
        h.model.setForeground(false)
        h.model.setForeground(true)
        assertEquals(emptyList(), h.speaker.spoken)
    }

    @Test fun `억제 중 실행 안내는 최신 1개만 보관, 해제 시 복구 발화·진동 없음`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.walkTo(0.0)
        settle()
        h.speaker.spoken.clear()
        h.model.outputSuppressed = true
        assertTrue(h.tones.isSuppressed)
        h.model.announceNow("억제 중")
        assertEquals(emptyList(), h.speaker.spoken)
        h.model.outputSuppressed = false
        assertFalse(h.tones.isSuppressed)
    }

    @Test fun `미디어 볼륨 0 → soundDegraded 행 + 문장 1회 + attention 진동`() = guideTest(dispatcher) { h ->
        h.tones.isMediaVolumeZero = true
        h.model.requestStart(h.request)
        settle()
        assertTrue(h.model.ui.value.soundDegraded)
        assertEquals(1, h.speaker.texts.count { it == h.catalog.get("android.guide.mediaVolumeZero") })
        assertEquals(listOf(ResultHapticKind.attention), h.haptics.fired)
        h.model.stopByUser()
        assertFalse(h.model.ui.value.soundDegraded)
    }

    @Test fun `거리 낭독은 m을 미터로 정정한다`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.walkTo(0.0)
        settle()
        val last = h.speaker.texts.last()
        assertTrue(last.contains("300 미터"), last)
        assertFalse(last.contains("300m"), last)
    }

    @Test fun `진행 상황 발화(간략) — 신선한 fix면 직선거리, 없으면 마지막 안내·noGuidanceYet, 상태 행에 남고 high`() = guideTest(dispatcher, { HttpResponse(200, "{\"result\":null}") }) { h ->
        h.model.requestStart(h.request)
        settle()
        h.speaker.spoken.clear()
        h.model.announceProgress()
        assertEquals(h.catalog.get("guide.noGuidanceYet") to true, h.speaker.spoken.single())
        h.walkTo(0.0)
        settle()   // 경로 없음 → 간략, 첫 fix 거리 통지
        h.walkTo(10.0)
        h.speaker.spoken.clear()
        h.model.announceProgress()
        val spoken = h.speaker.spoken.single()
        assertTrue(spoken.first.startsWith("목적지까지 약 "), spoken.first)
        assertTrue(spoken.second)
        assertEquals(h.model.ui.value.statusText, spoken.first.replace(" 미터", "m"))
    }

    @Test fun `톤 뒤 발화 — 시작 톤(1_3초) 직후 문장은 잔여 + 0_15초 뒤, 대기 중 선점되면 상환 장부(onDropped)가 복원된다`() = guideTest(dispatcher, { HttpResponse(200, straightRouteJson().replace("\"steps\"", "\"stepFree\":\"unavailable\",\"stepFreeNotice\":\"계단 회피 경로를 찾지 못했습니다\",\"steps\"")) }) { h ->
        h.tones.toneDurationSeconds = 1.3
        h.model.requestStart(h.request.copy(accessible = true))
        settle()
        assertEquals(h.clock.now + 1.3, h.tones.toneEndsAt)
        h.model.handleFix(h.fix(0.0))   // 시작 톤 재생 직후(잔여 1.3초) 경로 커밋 → 시작 문장은 1.45초 지연
        runCurrent()
        assertEquals(emptyList(), h.speaker.spoken)
        h.clock.now += 1.0; advanceTimeBy(1_000); runCurrent()
        assertEquals(emptyList(), h.speaker.spoken)
        h.clock.now += 0.5; advanceTimeBy(500); runCurrent()
        assertEquals(1, h.speaker.spoken.size)
        assertTrue(h.speaker.texts.single().startsWith("계단 회피 경로를 찾지 못했습니다 "), h.speaker.texts.single())

        // 선점: 대기 중인 문장이 즉시 창구에 밀려나면 열화 문장이 장부로 돌아가 전경 복귀에 갚아진다.
        h.speaker.spoken.clear()
        h.model.stopByUser()
        h.model.requestStart(h.request.copy(accessible = true))
        settle()
        h.model.handleFix(h.fix(0.0))
        runCurrent()
        assertEquals(emptyList(), h.speaker.spoken)
        h.model.announceNow("선점 문장")
        assertEquals(listOf("선점 문장"), h.speaker.texts)
        h.clock.now += 2.0; advanceTimeBy(2_000); runCurrent()
        assertEquals(listOf("선점 문장"), h.speaker.texts, "밀려난 문장은 뒤늦게 나가지 않는다")
        h.speaker.spoken.clear()
        h.model.setForeground(false)
        h.model.setForeground(true)
        assertEquals(1, h.speaker.spoken.size)
        assertTrue(h.speaker.texts.single().startsWith("계단 회피 경로를 찾지 못했습니다 "), h.speaker.texts.single())

        // 종료는 보류 문장을 onDropped 없이 버린다 — 끝난 세션의 문장이 뒤늦게 나가지 않는다.
        h.speaker.spoken.clear()
        h.model.stopByUser()
        h.model.requestStart(h.request)
        settle()
        h.model.handleFix(h.fix(0.0))
        runCurrent()
        h.model.stopByUser()
        h.clock.now += 3.0; advanceTimeBy(3_000); runCurrent()
        assertEquals(emptyList(), h.speaker.spoken)
    }

    @Test fun `restart — 저장된 시작 인자(계단 회피·최단·경유지)를 그대로 다시 쓴다, 추적 중·인자 없음은 no-op`() = guideTest(dispatcher) { h ->
        h.model.restart()
        assertEquals(0, h.controller.starts)
        h.perms.location = LocationPermission.Coarse
        h.model.requestStart(h.request.copy(accessible = true, variant = WalkRouteVariant.shortest))
        settle()
        assertEquals(FailResolution.precise, h.model.ui.value.failResolution)
        h.perms.location = LocationPermission.Fine
        h.model.clearFailure()
        h.model.restart()
        settle()
        assertEquals(GuideStatus.tracking, h.model.ui.value.status)
        assertEquals(WalkRouteVariant.shortest, h.model.ui.value.lastStartVariant)
        h.walkTo(0.0)
        settle()
        val url = h.transport.seenUrls.single()
        assertTrue(url.contains("accessible=true") && url.contains("variant=shortest"), url)
        h.model.restart()   // 추적 중 no-op
        assertEquals(1, h.controller.starts)
    }

    @Test fun `띠바 거리 — 10m 양자화(같은 구간은 유지, 넘으면 갱신)`() = guideTest(dispatcher, { HttpResponse(200, "{\"result\":null}") }) { h ->
        h.model.requestStart(h.request)
        settle()
        h.walkTo(0.0)   // 경로 origin으로 소비 → 경로 없음 → 간략
        settle()
        h.walkTo(0.0)   // 첫 간략 fix
        val first = h.model.ui.value.bandDistanceMeters!!
        assertTrue(first in 310..320, first.toString())
        h.walkTo(4.0)
        assertEquals(first, h.model.ui.value.bandDistanceMeters)
        h.walkTo(50.0)
        val second = h.model.ui.value.bandDistanceMeters!!
        assertTrue(second in 260..270 && second != first, second.toString())
    }

    @Test fun `속도 없는 fix(hasSpeed 거짓) — 걷는 중이면 정지 tick이 나지 않는다(0_0으로 접으면 거짓 정지)`() = guideTest(dispatcher, { HttpResponse(200, "{\"result\":null}") }) { h ->
        h.model.requestStart(h.request)
        settle()
        h.model.handleFix(h.fix(0.0, speed = null))
        settle()
        h.tones.played.clear()
        for (i in 1..10) {
            h.clock.now += 2.0
            h.model.handleFix(h.fix(2.6 * i, speed = null, accuracy = 8.0))
            advanceTimeBy(2_000); runCurrent()
        }
        assertEquals(0, h.tones.played.count { it == BeaconTone.tick }, h.tones.played.toString())
    }

    @Test fun `무음 진입 — 문장·failure 진동은 1회 래치, 톤마다 재발화하지 않는다, 풀리면 다시 무장`() = guideTest(dispatcher) { h ->
        h.tones.isSilenced = true
        h.model.requestStart(h.request)
        settle()
        val unavailable = h.catalog.get("android.beacon.soundUnavailable")
        assertEquals(1, h.speaker.texts.count { it == unavailable })
        assertEquals(1, h.haptics.fired.count { it == ResultHapticKind.failure })
        assertTrue(h.model.ui.value.isSilenced)
        // 워치독 unreliable 톤이 여러 번 나도 재발화 없음.
        repeat(3) { h.clock.now += 10.0; advanceTimeBy(10_000); runCurrent() }
        assertEquals(1, h.speaker.texts.count { it == unavailable })
        assertEquals(1, h.haptics.fired.count { it == ResultHapticKind.failure })
        h.tones.isSilenced = false
        h.clock.now += 10.0; advanceTimeBy(10_000); runCurrent()
        assertFalse(h.model.ui.value.isSilenced)
        h.tones.isSilenced = true
        h.clock.now += 10.0; advanceTimeBy(10_000); runCurrent()
        assertEquals(2, h.speaker.texts.count { it == unavailable })
        h.model.stopByUser()
        assertFalse(h.model.ui.value.isSilenced)
    }

    @Test fun `TTS 불가 — 시트 행 + failure 진동 1회, 게시는 false`() = guideTest(dispatcher) { h ->
        h.speaker.isUnavailable = true
        h.speaker.allow = false
        h.model.requestStart(h.request)
        settle()
        assertTrue(h.model.ui.value.ttsUnavailable)
        assertEquals(1, h.haptics.fired.count { it == ResultHapticKind.failure })
        h.model.announceNow("두 번째")
        assertEquals(1, h.haptics.fired.count { it == ResultHapticKind.failure })
        h.model.stopByUser()
        assertFalse(h.model.ui.value.ttsUnavailable)
    }

    @Test fun `시작 실패 착지 표식 — 실패 전이마다 failSeq 증가, takeFailLanding은 1회만 참`() = guideTest(dispatcher) { h ->
        assertFalse(h.model.takeFailLanding())
        h.perms.location = LocationPermission.Coarse
        h.model.requestStart(h.request)
        settle()
        assertEquals(1, h.model.ui.value.failSeq)
        assertTrue(h.model.takeFailLanding())
        assertFalse(h.model.takeFailLanding())
        h.model.clearFailure()
        h.model.requestStart(h.request)
        settle()
        assertEquals(2, h.model.ui.value.failSeq)
    }

    @Test fun `종료 화면 닫기 — 상태 행·하단 윗줄을 비운다(상환 꼬리가 종료 문장을 되읽지 않게)`() = guideTest(dispatcher) { h ->
        h.model.requestStart(h.request)
        settle()
        h.steps.liveSample = StepSample(120, null)
        h.model.stopByUser()
        assertEquals(h.catalog.get("android.beacon.stopped"), h.model.ui.value.endText)
        h.model.clearArrival()
        assertEquals("", h.model.ui.value.statusText)
        assertNull(h.model.ui.value.liveTopText)
        h.model.setForeground(false); h.speaker.spoken.clear()
        h.model.onSpeechDropped()          // 상환 장부만 선 상태
        h.model.setForeground(true)
        assertEquals(emptyList(), h.speaker.spoken)
    }
}

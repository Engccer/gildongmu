package space.dodoplanet.gildongmu.kit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 백그라운드 음성 안내(E53, spec 2026-09-30) — 채널 술어·분류·토글 실효값. Kit `GuideSpeechChannelTests.swift` 미러. */
class GuideSpeechChannelTest {
    /** 종전(E53 전) 도보 `post`: 전경이면 게시, 백그라운드면 버림. */
    private fun legacyBeaconChannel(foreground: Boolean) = if (foreground) GuideSpeechChannel.voiceOver else GuideSpeechChannel.drop

    /** 종전 나들이 `post`: 전경 ∧ VoiceOver면 VoiceOver, 그 밖은 기기 음성. */
    private fun legacyOutingChannel(foreground: Boolean, voiceOver: Boolean) =
        if (foreground && voiceOver) GuideSpeechChannel.voiceOver else GuideSpeechChannel.device

    private data class Inputs(val foreground: Boolean, val voiceOver: Boolean, val cls: GuideSpeechClass, val enabled: Boolean, val audible: Boolean)

    private val allInputs: List<Inputs> = listOf(true, false).flatMap { fg ->
        listOf(true, false).flatMap { vo ->
            GuideSpeechClass.entries.flatMap { cls ->
                listOf(true, false).flatMap { on -> listOf(true, false).map { au -> Inputs(fg, vo, cls, on, au) } }
            }
        }
    }

    /** 백그라운드에서 말하는 분류 — 구현식을 되풀이하지 않는 명시 집합. */
    private val spokenInBackground = setOf(GuideSpeechClass.actionable, GuideSpeechClass.urgent)

    private fun channel(i: Inputs, outing: Boolean) = guideSpeechChannel(
        foreground = i.foreground, voiceOverRunning = i.voiceOver, speechClass = i.cls,
        backgroundSpeechEnabled = i.enabled, backgroundAudible = i.audible, foregroundDeviceSpeech = outing,
    )

    @Test fun releaseEquivalenceForBeaconAndTransit() {
        assertEquals(48, allInputs.size, "입력 전 조합 2^4 × 분류 3")
        for (i in allInputs.filter { !it.enabled }) assertEquals(legacyBeaconChannel(i.foreground), channel(i, outing = false), "$i")
    }

    @Test fun enabledChangesOnlyAudibleBackgroundActionable() {
        for (i in allInputs.filter { it.enabled }) {
            val expected = if (!i.foreground && i.audible && i.cls in spokenInBackground) GuideSpeechChannel.device else legacyBeaconChannel(i.foreground)
            assertEquals(expected, channel(i, outing = false), "$i")
        }
    }

    @Test fun outingFollowsToggleOnlyInBackground() {
        for (i in allInputs) {
            val expected = if (i.foreground) legacyOutingChannel(true, i.voiceOver)
            else if (i.enabled && i.audible && i.cls in spokenInBackground) GuideSpeechChannel.device else GuideSpeechChannel.drop
            assertEquals(expected, channel(i, outing = true), "$i")
        }
    }

    @Test fun toggleEffectiveValue() {
        assertTrue(BackgroundSpeech.defaultEnabled)
        assertEquals(true, BackgroundSpeech.isEnabled(null))
        assertEquals(false, BackgroundSpeech.isEnabled(false))
        assertEquals(true, BackgroundSpeech.isEnabled(true))
        assertEquals("backgroundSpeechEnabled", BackgroundSpeech.storageKey)
    }

    @Test fun guideEventClassification() {
        val actionable = listOf(
            GuideEvent.AnnounceSteps(listOf(0), late = false), GuideEvent.FarNotice(listOf(2), 300), GuideEvent.WaypointReached,
            GuideEvent.WaypointApproaching(40), GuideEvent.BackOnRoute,
        )
        for (e in actionable) assertEquals(GuideSpeechClass.actionable, guideEventSpeechClass(e, offRouteEpisodeStart = false), "$e")
        val deferrable = listOf(
            GuideEvent.BundleReread(listOf(0)), GuideEvent.Periodic(0, 120, 5.0), GuideEvent.UncertainEnter, GuideEvent.UncertainExit,
            GuideEvent.Reacquiring, GuideEvent.Reacquired, GuideEvent.SpeedSuggest, GuideEvent.FinalApproachEnter,
        )
        for (e in deferrable) assertEquals(GuideSpeechClass.deferrable, guideEventSpeechClass(e, offRouteEpisodeStart = true), "$e")
        assertEquals(GuideSpeechClass.urgent, guideEventSpeechClass(GuideEvent.Imminent(listOf(1), WalkAction.left, 0), offRouteEpisodeStart = false))
        assertEquals(GuideSpeechClass.urgent, guideEventSpeechClass(GuideEvent.Imminent(listOf(1), WalkAction.left, 2), offRouteEpisodeStart = true))
        assertEquals(GuideSpeechClass.actionable, guideEventSpeechClass(GuideEvent.OffRoute, offRouteEpisodeStart = true))
        assertEquals(GuideSpeechClass.deferrable, guideEventSpeechClass(GuideEvent.OffRoute, offRouteEpisodeStart = false))
    }

    @Test fun beaconNoticeClassification() {
        assertEquals(GuideSpeechClass.actionable, beaconNoticeSpeechClass(BeaconNotice.Nearby(10)))
        for (n in listOf(BeaconNotice.First(300), BeaconNotice.Closer(200), BeaconNotice.Farther(220), BeaconNotice.Weak)) {
            assertEquals(GuideSpeechClass.deferrable, beaconNoticeSpeechClass(n), "$n")
        }
    }

    @Test fun transitEventClassification() {
        val actionable = listOf(
            TransitGuideEvent.VehicleSelected(0), TransitGuideEvent.VehiclePassed, TransitGuideEvent.ArrivingAtBoardStop,
            TransitGuideEvent.ArrivingAtAlightStop, TransitGuideEvent.Boarded(0, TransitBoardedCause.observed),
            TransitGuideEvent.Boarded(0, TransitBoardedCause.departed), TransitGuideEvent.Boarded(0, TransitBoardedCause.declared),
            TransitGuideEvent.Arrived(true), TransitGuideEvent.Arrived(false), TransitGuideEvent.LegAdvanced(1, false),
            TransitGuideEvent.LegAdvanced(1, true), TransitGuideEvent.NeverSeen, TransitGuideEvent.Approaching(1, "", null),
            TransitGuideEvent.Countdown(1, "", null, null, null, null),
        )
        for (e in actionable) assertEquals(GuideSpeechClass.actionable, transitEventSpeechClass(e), "$e")
        val deferrable = listOf(
            TransitGuideEvent.Approaching(2, "", null), TransitGuideEvent.Approaching(null, "", null),
            TransitGuideEvent.Countdown(2, "", null, null, null, null), TransitGuideEvent.TrackingStarted("", null, 3, null),
            TransitGuideEvent.MessageChanged("", null, null), TransitGuideEvent.BackOnTrack("", null, null),
            TransitGuideEvent.ApproxVehicleChanged("", null), TransitGuideEvent.SignalLost, TransitGuideEvent.UpstreamFailed,
            TransitGuideEvent.SignalRecovered, TransitGuideEvent.BoardingReset, TransitGuideEvent.CapSlowed,
        )
        for (e in deferrable) assertEquals(GuideSpeechClass.deferrable, transitEventSpeechClass(e), "$e")
        for (e in actionable + deferrable) if (transitEventProfile(e).interrupt) assertEquals(GuideSpeechClass.actionable, transitEventSpeechClass(e), "$e")
    }

    @Test fun endBridgeCoversSpeechStart() {
        assertTrue(deviceSpeechEndBridgeSeconds > SpeechDeferConstants.speechDeferGapSeconds + DeviceSpeechQueue.pollSeconds)
        assertTrue(deviceSpeechEndWaitMaxSeconds >= 12)
    }
}

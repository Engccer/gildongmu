package space.dodoplanet.gildongmu.guide

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.junit.jupiter.api.extension.RegisterExtension
import space.dodoplanet.gildongmu.MainDispatcherExtension
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.WalkHealth
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
private fun TestScope.settle() { runCurrent(); advanceTimeBy(1); runCurrent() }

/**
 * E31 체중 입력 권유의 무시 상한(spec 2026-09-11): 판정은 :kit `WalkHealth`(`shouldShowWeightPrompt`·`nextWeightPromptDismissals`)이고
 * 여기는 호출 배선 — 무엇을 세는가([닫기]만), 응답 표식, 설정 복귀 재계산, 저장 키 이름 — 을 잠근다.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WalkGuideWeightPromptTest {
    private val dispatcher = StandardTestDispatcher()

    @JvmField
    @RegisterExtension
    val main = MainDispatcherExtension(dispatcher)

    /** 기본 체중(미입력)으로 의미 있는 보행을 끝내 종료 화면을 띄운다. */
    private fun TestScope.endWalk(h: GuideTestHarness) {
        h.model.requestStart(h.request)
        settle()
        h.steps.liveSample = StepSample(steps = 1200, distanceMeters = null)
        h.model.stopByUser()
    }

    private fun GuideTestHarness.dismissals() = store.getString("walkWeightPromptDismissals")?.toInt() ?: 0

    @Test fun `닫기로 두 번 무시하면 세 번째 종료 화면에 권유가 없다 — 저장 키는 iOS와 같은 이름`() = guideTest(dispatcher) { h ->
        assertEquals("walkWeightPromptDismissals", WalkHealth.weightPromptDismissalsKey)
        assertEquals("walkWeightPromptEngaged", WalkHealth.weightPromptEngagedKey)
        endWalk(h)
        assertTrue(h.model.ui.value.weightPromptShown)
        h.model.closeEndScreen()
        assertEquals(1, h.dismissals())
        endWalk(h)
        assertTrue(h.model.ui.value.weightPromptShown)
        h.model.closeEndScreen()
        assertEquals(2, h.dismissals())
        endWalk(h)
        assertFalse(h.model.ui.value.weightPromptShown)
        assertTrue(h.model.ui.value.arrivalHealth!!.usedDefaultWeight)
        h.model.closeEndScreen()
        assertEquals(2, h.dismissals(), "권유가 없는 화면의 닫기는 세지 않는다")
    }

    @Test fun `체중 입력하기를 누른 뒤의 닫기는 세지 않고 표식은 소비된다`() = guideTest(dispatcher) { h ->
        endWalk(h)
        h.model.engageWeightPrompt()
        assertEquals("true", h.store.getString("walkWeightPromptEngaged"))
        h.model.closeEndScreen()
        assertEquals(0, h.dismissals())
        assertEquals("false", h.store.getString("walkWeightPromptEngaged"))
        endWalk(h)
        h.model.closeEndScreen()
        assertEquals(1, h.dismissals(), "표식이 다음 화면으로 새지 않는다")
    }

    @Test fun `닫기 밖의 소거(만료·새 세션)는 세지 않는다`() = guideTest(dispatcher) { h ->
        endWalk(h)
        h.model.clearArrival()
        endWalk(h)
        h.model.requestStart(h.request)   // 새 세션 시작이 종료 화면을 지운다
        settle()
        assertNull(h.model.ui.value.arrivalDest)
        assertEquals(0, h.dismissals())
    }

    @Test fun `설정에서 체중을 입력하고 돌아오면 재계산 — 권유가 사라지고 뒤이은 닫기는 세지 않는다`() = guideTest(dispatcher) { h ->
        endWalk(h)
        val before = h.model.ui.value.arrivalHealth!!
        h.model.engageWeightPrompt()
        assertTrue(h.model.takeWeightSettingsReturn())
        assertFalse(h.model.takeWeightSettingsReturn(), "1회 소비")
        h.store.putString(WalkHealth.weightStorageKey, "80")
        h.model.recomputeArrivalHealth()
        val after = h.model.ui.value.arrivalHealth!!
        assertFalse(after.usedDefaultWeight)
        assertTrue(after.kcal > before.kcal)
        assertFalse(h.model.ui.value.weightPromptShown)
        h.model.closeEndScreen()
        assertEquals(0, h.dismissals())
    }

    @Test fun `권유가 없는 화면에서는 응답 표식을 세우지 않는다`() = guideTest(dispatcher) { h ->
        h.store.putString(WalkHealth.weightStorageKey, "70")
        endWalk(h)
        assertFalse(h.model.ui.value.weightPromptShown)
        h.model.engageWeightPrompt()
        assertFalse(h.store.getString("walkWeightPromptEngaged") == "true")
        assertFalse(h.model.takeWeightSettingsReturn())
    }

    @Test fun `응답 표식은 만료·새 세션으로 사라진 화면을 넘어 새지 않는다`() = guideTest(dispatcher) { h ->
        endWalk(h)
        h.model.engageWeightPrompt()
        h.model.clearArrival()   // 30분 만료 경로
        endWalk(h)
        assertFalse(h.model.takeWeightSettingsReturn())
        h.model.closeEndScreen()
        assertEquals(1, h.dismissals())
        endWalk(h)
        h.model.engageWeightPrompt()
        h.model.requestStart(h.request)   // 설정에서 돌아와 시트를 열지 않고 새 안내 시작
        settle()
        h.steps.liveSample = StepSample(steps = 1200, distanceMeters = null)
        h.model.stopByUser()
        assertFalse(h.model.takeWeightSettingsReturn(), "새 종료 화면의 착지는 종료 문장이다")
        h.model.closeEndScreen()
        assertEquals(2, h.dismissals())
    }

    /** 뷰 배선(Compose는 JVM 레인이 없다): 카운터 대입은 한 곳, [닫기]가 그 함수를 부르고, 갱신이 `clearArrival()`보다 앞이다. */
    @Test fun `배선 가드 — 카운터 대입 1곳·닫기 순서·닫기 버튼 호출`() {
        val src = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu/guide")
        val model = src.resolve("WalkGuideModel.kt").readText()
        assertEquals(1, Regex("""\n\s*weightPromptDismissals = """).findAll(model).count())
        val close = model.substringAfter("fun closeEndScreen() {").substringBefore("\n    }\n")
        assertTrue(close.indexOf("weightPromptDismissals =") in 0 until close.indexOf("clearArrival()"), close)
        assertTrue(close.indexOf("weightPromptEngaged = false") in 0 until close.indexOf("clearArrival()"), close)
        val sheet = src.resolve("ui/GuideSheet.kt").readText()
        assertTrue(sheet.contains("""Button(onClick = { GuideSession.walk.closeEndScreen() }"""), "종료 화면 [닫기] = closeEndScreen")
        assertFalse(sheet.contains("walk.clearArrival()"), "시트가 카운터를 우회해 소거하지 않는다")
        // 설정 복귀: 1회 표식 소비 → 재계산 → 그 결과로 착지 선택(재계산이 빠지면 체중을 넣고 와도 권유·65kg 문장이 남는다).
        val back = sheet.substringAfter("if (model.takeWeightSettingsReturn()) {").substringBefore("} else {")
        assertTrue(back.indexOf("model.recomputeArrivalHealth()") in 0 until back.indexOf("weightPromptShown"), back)
        // 설정 push 경로는 띠바 착지를 1회 건너뛴다(설정 화면 착지를 가로채지 않게), 설정을 벗어나면 시트를 다시 연다.
        val button = sheet.substringAfter("GuideSession.walk.engageWeightPrompt()").substringBefore("onOpenSettings()")
        assertTrue(button.contains("GuideSession.suppressNextBandLanding = true") && button.contains("GuideSession.isMinimized = true"), button)
        val nav = src.resolve("ui/WeightSettingsNav.kt").readText()
        assertTrue(nav.contains("GuideSession.reopenAfterWeightSettings()"))
        val root = Fixtures.repoRoot.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu/nav/AppRoot.kt").readText()
        assertTrue(root.contains("GuideBottomBar(onOpenSettings = navController::openWeightSettings)"))
    }
}

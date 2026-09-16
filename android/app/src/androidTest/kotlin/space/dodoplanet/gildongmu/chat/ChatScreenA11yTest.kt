package space.dodoplanet.gildongmu.chat

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.lifecycle.SavedStateHandle
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.flow
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import space.dodoplanet.gildongmu.kit.InMemoryKeyValueStore
import space.dodoplanet.gildongmu.kit.models.ChatRenderPayload
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.ChatSource
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent
import space.dodoplanet.gildongmu.kit.models.Place
import space.dodoplanet.gildongmu.kit.models.PlaceSort

/**
 * 실기기 검사 레인(M6 spec §9): 동의 → 필드 착지 → 추천 질문 전송 → 보내기 버튼 착지(계측은 터치 입력 모드라 `canFocus` 덮어쓰기가 빠지면 빨갛다)
 * → 완료 → 질문 헤딩 착지 → 블록·카드 행 ATF 검사. 머신 게이트 밖 — `adb` 연결 시 `./gradlew :app:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class ChatScreenA11yTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val cafe = Place(id = "c1", name = "카페 길동", category = "음식점 > 카페", address = "서울 강동구", roadAddress = "서울 강동구 천호대로 1", lat = 37.53, lng = 127.13)

    private fun model(stream: ChatStreamSource): ChatViewModel {
        val res = rule.activity.applicationContext.resources
        return ChatViewModel(
            place = null,
            stream = stream,
            suggestions = { _, _, _, _ -> emptyList() },
            geocode = { null },
            consent = ChatConsentStore(InMemoryKeyValueStore()),
            location = object : ChatLocation {
                override suspend fun prime() = Unit
                override fun last(): ChatRequestBody.Coordinate? = null
            },
            lang = { "ko" },
            dataLocale = { "ko" },
            strings = chatStrings(res),
            sounds = object : ChatSounds {
                override fun send() = Unit
                override fun receive() = Unit
            },
            savedState = SavedStateHandle(),
        )
    }

    @Test
    fun consentSendCompleteLandsAndPassesAccessibilityChecks() {
        val release = CompletableDeferred<Unit>()
        val done = ChatStreamEvent.Done(
            "## 주변\n\n카페 길동이 가깝습니다.\n\n- 천호대로 1",
            listOf(ChatRenderPayload.Places(listOf(cafe), PlaceSort.accuracy)),
            listOf(ChatSource("source.kakao")),
        )
        val vm = model { flow { emit(ChatStreamEvent.Status(listOf("search_places"))); release.await(); emit(done) } }
        rule.setContent { MaterialTheme { ChatTabScreen(vm = vm) {} } }
        rule.enableAccessibilityChecks()

        rule.onNodeWithTag("consent-agree").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("chat-field").assertIsFocused()

        rule.onNodeWithTag("suggestion-0").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("chat-send").assertIsFocused()

        release.complete(Unit)
        rule.waitUntil(5_000) { vm.state.value.answerRevision == 1 }
        rule.waitForIdle()
        rule.onNodeWithTag("question-1").assertIsFocused() // 질문 id 1, 답변 id 2
        rule.onNodeWithTag("block-2-0").assertExists() // 헤딩 블록
        rule.onNodeWithTag("block-2-1").assertExists() // 장소 언급 1개 = 블록 버튼
        rule.onNodeWithTag("place-c1").assertExists()
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    @Test
    fun typingDuringStreamKeepsFieldFocusAndFailureIsAnnounced() {
        val release = CompletableDeferred<Unit>()
        val vm = model { flow { release.await(); emit(ChatStreamEvent.Error("chat_failed")) } }
        vm.grantConsent()
        rule.setContent { MaterialTheme { ChatTabScreen(vm = vm) {} } }

        rule.onNodeWithTag("suggestion-0").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("chat-field").performClick()
        rule.onNodeWithTag("chat-field").performTextInput("다음 질문")
        release.complete(Unit)
        rule.waitUntil(5_000) { vm.state.value.answerRevision == 1 }
        rule.waitForIdle()
        rule.onNodeWithTag("chat-field").assertIsFocused()
        rule.onNodeWithTag("status").assertTextEquals("답변을 가져오지 못했습니다.")
    }
}

package space.dodoplanet.gildongmu.chat

import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions.assumeTrue
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.kit.models.ChatRenderPayload
import space.dodoplanet.gildongmu.kit.models.ChatRequestBody
import space.dodoplanet.gildongmu.kit.models.ChatStreamEvent
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * 실호출 게이트(spec §9, 수동): 프로덕션 `/api/chat`·`/api/chat/suggestions`를 실제 전송기로 부른다. 리밋(60초 10회)과 Gemini 비용 때문에
 * 머신 게이트에서는 돌지 않는다 — `GILDONGMU_REAL_CALL=1 ./gradlew :app:testDebugUnitTest --tests '*ChatRealCallTest'`.
 * JVM `HttpURLConnection`이라 기기 전송 구현(OkHttp 기반)의 취소 동작은 여기서 보지 않는다(spec §8).
 */
class ChatRealCallTest {
    @Test fun `일반 채팅 스트림이 진행·완료·장소 카드를 실제로 싣는다`() {
        assumeTrue(System.getenv("GILDONGMU_REAL_CALL") == "1")
        val body = ChatRequestBody(messages = listOf(ChatRequestBody.Turn("user", "강남역 근처 카페 알려줘")), locale = "ko")
        val events = runBlocking { HttpChatStreamSource(AppConfig.API_BASE_URL).events(body).toList() }
        val statuses = events.filterIsInstance<ChatStreamEvent.Status>()
        val done = events.filterIsInstance<ChatStreamEvent.Done>()
        println("realcall status=${statuses.map { it.categories }} done=${done.size} renders=${done.firstOrNull()?.renders?.map { it::class.simpleName }} textLen=${done.firstOrNull()?.text?.length}")
        assertTrue(statuses.isNotEmpty(), "status 이벤트 0")
        assertTrue(done.size == 1, "done 이벤트 ${done.size}")
        assertTrue(done.single().text.isNotEmpty(), "빈 답변")
        assertTrue(done.single().renders.any { it is ChatRenderPayload.Places && it.places.isNotEmpty() }, "장소 카드 없음")

        val question = body.messages.single().text
        val chips = runBlocking { HttpChatSuggestionsSource(AppConfig.API_BASE_URL).fetch(question, done.single().text, "ko", null) }
        // 전송 계약만 단언한다(예외 없이 목록, 상한 3). 2026-09-16 프로덕션은 서버 6초 생성 상한에 걸려 매번 6.1초 뒤 빈 목록을 준다
        // (curl 2회 실측 — 앱 전송기와 무관, 모든 클라이언트 공통, 코디네이터 보고). 서버가 고쳐지면 1..3으로 조인다.
        println("realcall followUps=$chips")
        assertTrue(chips.size <= 3, "follow-up ${chips.size}개")
    }
}

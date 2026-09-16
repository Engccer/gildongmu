package space.dodoplanet.gildongmu.chat

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** 채팅 구조 가드(spec §9). 착지 부착 규율은 `nav/AppSourceGuardTest`가 앱 전체에서 잠근다. */
class ChatSourceGuardTest {
    private val root = Fixtures.repoRoot
    private val chatDir = root.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu/chat")
    private val chat = chatDir.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()

    private fun code(name: String) = chatDir.resolve(name).readText()

    @Test fun `줄 분리는 kit splitStreamLines만 — 앱에서 줄을 새로 나누지 않는다`() {
        assertTrue(chat.isNotEmpty())
        val banned = Regex("""readLine\(|lineSequence\(|BufferedReader|\.lines\(\)|bufferedReader\(""")
        assertEquals(emptyList(), chat.filter { banned.containsMatchIn(it.readText()) }.map { it.name })
        assertTrue(code("ChatStream.kt").contains("ChatService.splitStreamLines("))
        assertTrue(code("ChatStream.kt").contains("ChatService.eventFromStreamLine("))
    }

    @Test fun `채팅 버튼은 enabled로 끄지 않는다(포커스를 떨군다 — 헌장 §5)`() {
        // 주석 속 설명("enabled=false는 …")은 빼고 코드만 본다(줄 주석·KDoc 줄)
        val code = { f: java.io.File ->
            f.readLines().filterNot { val t = it.trimStart(); t.startsWith("*") || t.startsWith("/**") }.map { it.substringBefore("//") }.joinToString("\n")
        }
        assertEquals(emptyList(), chat.filter { Regex("""\benabled\s*=""").containsMatchIn(code(it)) }.map { it.name })
        assertTrue(Regex("""\benabled\s*=""").containsMatchIn("Button(enabled = false)")) // 가드가 살아 있다
    }

    @Test fun `채팅 화면이 pop 복귀 슬롯을 실제로 부른다`() {
        val screen = code("ChatScreen.kt")
        assertTrue(screen.contains("vm.takeReturnFocus()"))
        assertTrue(screen.contains("vm.rememberReturnFocus("))
    }

    private val appMain = root.resolve("android/app/src/main/kotlin/space/dodoplanet/gildongmu")
    private val appSources = appMain.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    private val sessionFile = "speech/DictationSession.kt"

    @Test fun `받아쓰기 세션 생성은 dictationSessionOrNull 한 곳(D9 게이트)이고 화면은 rememberDictation만 부른다`() {
        val construct = Regex("""(?<!class )\bDictationSession\(""")
        val constructors = appSources.flatMap { f -> construct.findAll(f.readText()).map { f.relativeTo(appMain).path }.toList() }
        assertEquals(listOf(sessionFile), constructors)
        val gate = appMain.resolve(sessionFile).readText().substringAfter("fun dictationSessionOrNull(").substringBefore("\n}")
        assertTrue(gate.contains("Dictation.isAvailable(context)") && gate.contains("DictationSession("))
        assertEquals(emptyList(), appSources.filter { it.readText().contains("dictationSessionOrNull(") && it.relativeTo(appMain).path !in setOf(sessionFile, "chat/ChatDictation.kt") }.map { it.name })
        assertTrue(code("ChatScreen.kt").contains("rememberDictation("))
    }

    @Test fun `인식기는 온디바이스만(서버 인식 폴백 0 — 개인정보 신고 오디오 미수집)`() {
        assertEquals(emptyList(), appSources.filter { Regex("""\bcreateSpeechRecognizer\(""").containsMatchIn(it.readText()) }.map { it.name })
        assertTrue(appMain.resolve(sessionFile).readText().contains("SpeechRecognizer.createOnDeviceSpeechRecognizer("))
    }

    @Test fun `스크린 리더 낭독 끊기는 한 곳이고 접근성 서비스가 켜졌을 때만(꺼진 기기에서 크래시)`() {
        val calls = appSources.flatMap { f -> Regex("""\.interrupt\(\)""").findAll(f.readText()).map { f.name }.toList() }
        assertEquals(listOf("DictationSession.kt"), calls)
        val body = appMain.resolve(sessionFile).readText().substringAfter("override fun interruptScreenReader()").substringBefore("override fun")
        assertTrue(body.contains("isEnabled") && body.contains(".interrupt()"))
    }

    @Test fun `장소 채팅 예시 프롬프트 표는 kit placeChatPromptKeys 키 전수다(키가 늘면 조용히 빠지지 않게)`() {
        val key = Regex(""""(placeChat\.prompt\.[A-Za-z]+)"""")
        val kit = key.findAll(root.resolve("android/kit/src/main/kotlin/space/dodoplanet/gildongmu/kit/PlaceChatPrompts.kt").readText()).map { it.groupValues[1] }.toSet()
        val table = Regex(""""(placeChat\.prompt\.[A-Za-z]+)" -> R\.string\.""").findAll(code("ChatScreen.kt")).map { it.groupValues[1] }.toSet()
        assertEquals(9, kit.size)
        assertEquals(kit, table)
    }

    @Test fun `도구·출처 라벨 표는 iOS 표와 같은 키 전수다`() {
        val caseKey = Regex("""case "([^"]+)":""")
        val iosTools = caseKey.findAll(root.resolve("ios/Gildongmu/Chat/ChatModel.swift").readText()).map { it.groupValues[1] }.toSet()
        val iosSources = caseKey.findAll(root.resolve("ios/Gildongmu/Chat/ChatConversationView.swift").readText())
            .map { it.groupValues[1] }.filter { it.startsWith("source.") }.toSet()
        val strings = code("ChatStrings.kt")
        val kotlinTools = Regex(""""([a-z_]+)" -> R\.string\.chat_progress_tool_""").findAll(strings).map { it.groupValues[1] }.toSet()
        val kotlinSources = Regex(""""(source\.[a-z]+)" -> R\.string\.chat_source_""").findAll(strings).map { it.groupValues[1] }.toSet()
        assertEquals(19, iosTools.size)
        assertEquals(iosTools, kotlinTools)
        assertEquals(iosSources, kotlinSources)
        iosTools.forEach { assertTrue(toolLabelId(it) != null, it) }
        iosSources.forEach { assertTrue(sourceLabelId(it) != null, it) }
    }
}

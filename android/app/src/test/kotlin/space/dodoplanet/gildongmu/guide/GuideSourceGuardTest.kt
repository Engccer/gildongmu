package space.dodoplanet.gildongmu.guide

import space.dodoplanet.gildongmu.kit.Fixtures
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * `guide/`·`audio/` 구조 가드(spec §10-1 소스 가드 ①②③④⑥⑦⑧⑩⑪⑫⑬ — ⑤는 `ToneDurationsTest`, ⑨는 조각 ③에서 더한다).
 * 값을 특정 경로에서 배제할 때 1선은 구조, 2선이 이 가드다(CLAUDE.md). 어느 컴파일러도 잡지 못하는 배선 계약만 잠근다.
 */
class GuideSourceGuardTest {
    private val app = Fixtures.repoRoot.resolve("android/app/src/main")
    private val pkg = app.resolve("kotlin/space/dodoplanet/gildongmu")
    private val guide = pkg.resolve("guide")
    private val audio = pkg.resolve("audio")
    private val allSources = pkg.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
    private val guideSources = listOf(guide, audio).flatMap { d -> d.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList() }

    private fun offenders(files: List<java.io.File>, pattern: Regex): List<String> =
        files.flatMap { f -> f.readLines().withIndex().filter { pattern.containsMatchIn(it.value) }.map { "${f.name}:${it.index + 1}" } }

    @Test fun `① startWalk 호출부는 WalkGuideStartButton 한 곳`() {
        val callers = allSources.filter { it.name != "GuideSession.kt" && it.readText().contains("GuideSession.startWalk(") }.map { it.name }
        // 조각 ③ 전엔 0곳, 뒤엔 정확히 그 한 곳(다른 진입점이 생기면 빨강).
        assertTrue(callers.isEmpty() || callers == listOf("WalkGuideStartButton.kt"), callers.toString())
    }

    @Test fun `② startWalk·GuideBottomBar는 실험 게이트로 시작한다`() {
        val session = guide.resolve("GuideSession.kt").readText()
        val body = session.substringAfter("fun startWalk(").substringAfter("{").substringBefore("\n        if (isActive)")
        assertTrue(body.contains("experimentalEnabled()"), "startWalk 첫 문장이 게이트다: $body")
        assertTrue(session.contains("var experimentalEnabled: () -> Boolean = { AppConfig.experimentalGuidanceEnabled }"))
        val bar = guide.resolve("ui/GuideBottomBar.kt")
        if (bar.isFile) {
            val text = bar.readText()
            val first = text.substringAfter("fun GuideBottomBar(").substringAfter("{").trim().lineSequence().first()
            assertTrue(first.contains("experimentalGuidanceEnabled"), "GuideBottomBar 첫 문장이 게이트다: $first")
        }
        val attach = session.substringAfter("fun attach(").substringAfter("{").trim().lineSequence().first()
        assertTrue(attach.startsWith("if (::walk.isInitialized) return"), "attach 첫 줄은 멱등 가드: $attach")
    }

    @Test fun `③ 오디오·진동·TTS 플랫폼 API는 audio 지정 파일만`() {
        val bad = Regex("""\bSoundPool\b|\bTextToSpeech\(|\bVibrator\b|\bVibrationEffect\b|\bAudioFocusRequest\b|\bVibratorManager\b""")
        val allowed = setOf("GuideTonePlayer.kt", "TtsGuideSpeaker.kt", "ToneHaptics.kt", "GuideAudioFocus.kt")
        val files = allSources.filter { bad.containsMatchIn(it.readText()) }
        assertTrue(files.isNotEmpty())
        assertEquals(emptySet(), files.map { it.name }.toSet() - allowed, "audio/ 지정 파일 밖의 플랫폼 오디오 참조")
        assertTrue(files.all { it.parentFile.name == "audio" })
    }

    @Test fun `④ speaker_speak 호출부는 WalkGuideModel_post 한 곳`() {
        val callers = allSources.filter { it.name != "TtsGuideSpeaker.kt" && Regex("""speaker\.speak\(""").containsMatchIn(it.readText()) }.map { it.name }
        assertEquals(listOf("WalkGuideModel.kt"), callers)
        val model = guide.resolve("WalkGuideModel.kt").readText()
        assertEquals(1, Regex("""speaker\.speak\(""").findAll(model).count())
        val postBody = model.substringAfter("private fun post(").substringBefore("\n    }\n")
        assertTrue(postBody.contains("speaker.speak("))
    }

    @Test fun `⑥ 위치 플랫폼 API는 GuideLocationStream 한 곳`() {
        val bad = Regex("""import android\.location|LocationManager|LocationListener""")
        val files = guideSources.filter { bad.containsMatchIn(it.readText()) }.map { it.name }
        assertEquals(listOf("GuideLocationStream.kt"), files)
    }

    @Test fun `⑦ 매니페스트 — location 전경 서비스 1개, 배경 위치 0, MainActivity launchMode 무변경`() {
        val manifest = app.resolve("AndroidManifest.xml").readText()
        assertEquals(1, Regex("""foregroundServiceType="location"""").findAll(manifest).count())
        assertTrue(manifest.contains("android:name=\".guide.GuideForegroundService\""))
        assertTrue(!manifest.contains("ACCESS_BACKGROUND_LOCATION"))
        assertTrue(!manifest.contains("launchMode"))
    }

    @Test fun `⑧ guide·audio 소스의 문자열 키는 전부 매핑 표에 있다`() {
        val keyShape = Regex("""^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$""")
        val used = guideSources.filter { it.name != "GuideStrings.kt" }
            .flatMap { f -> Regex(""""((?:[^"\\]|\\.)*)"""").findAll(f.readText()).map { it.groupValues[1] }.toList() }
            .filter { keyShape.matches(it) }
            // 인텐트 액션·태그는 키 모양이지만 문자열 자원이 아니다.
            .filterNot { it.startsWith("space.dodoplanet.") || it.startsWith("gildongmu.") || it.startsWith("android.location.") }
            .toSet()
        assertTrue(used.size > 40, "스캔이 살아 있다: ${used.size}")
        assertTrue("guide.detailStart" in used && "android.guide.serviceStartFailed" in used)
        val missing = used.filter { guideStringId(it) == null }.sorted()
        assertEquals(emptyList(), missing)
    }

    @Test fun `⑩ androidx_core 의존 0 — 플랫폼 API만`() {
        assertEquals(emptyList(), offenders(guideSources, Regex("""import androidx\.core\.""")))
    }

    @Test fun `⑪ requestFocus는 runCatching 안에서만`() {
        val bad = guideSources.flatMap { f ->
            val lines = f.readLines()
            lines.withIndex().filter { (i, line) ->
                line.contains(".requestFocus()") && !line.contains("runCatching") && !(i > 0 && lines[i - 1].contains("runCatching {"))
            }.map { "${f.name}:${it.index + 1}" }
        }
        assertEquals(emptyList(), bad)
    }

    @Test fun `⑫ guide에 focusRequester 직접 부착 0 — mergedRow·landingTarget만`() {
        assertEquals(emptyList(), offenders(guideSources, Regex("""\.focusRequester\(""")))
    }

    @Test fun `⑬ PendingIntent는 전부 FLAG_IMMUTABLE`() {
        val calls = guideSources.flatMap { f ->
            val text = f.readText()
            Regex("""PendingIntent\.get\w+\(""").findAll(text).map { m -> text.substring(m.range.first, minOf(text.length, m.range.first + 400)) }.toList()
        }
        assertTrue(calls.isNotEmpty())
        assertTrue(calls.all { it.contains("FLAG_IMMUTABLE") }, calls.joinToString("\n---\n"))
    }
}

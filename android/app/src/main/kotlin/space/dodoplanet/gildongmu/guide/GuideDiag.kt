package space.dodoplanet.gildongmu.guide

import android.util.Log
import space.dodoplanet.gildongmu.BuildConfig
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * 도보 안내 세션 계측(spec §8, iOS `GuideDiag`·`DiagFileLog` 대응). 방위 축·워치독·오디오 파라미터를 정하는 유일한 근거라
 * 매 fix의 원시값을 iOS와 같은 줄 형식으로 남긴다(기존 리플레이 스크립트가 그대로 읽는다).
 *
 * 게이트는 `DEBUG || EXPERIMENTAL` — 릴리스는 no-op이고 문자열 조립 자체가 인라인 람다로 건너뛴다. 파일 싱크(앱 전용 외부 저장소
 * `guide-diag.log`, 2MB 교체)는 [attachFileSink]로 붙인다(전경 서비스 시작 시). JVM 테스트는 [lines]로 읽는다.
 */
object GuideDiag {
    private const val TAG = "GuideDiag"
    private val enabled = BuildConfig.DEBUG || BuildConfig.EXPERIMENTAL
    private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).apply { timeZone = TimeZone.getTimeZone("UTC") }

    /** 최근 줄(테스트·진단용 순환 버퍼). */
    val lines: ArrayDeque<String> = ArrayDeque()
    private const val maxLines = 500

    /** 파일 싱크(있으면). 부착은 Task 18. */
    @Volatile var sink: ((String) -> Unit)? = null

    inline fun log(msg: () -> String) {
        if (!isEnabled) return
        emit(msg())
    }

    fun log(msg: String) {
        if (!isEnabled) return
        emit(msg)
    }

    val isEnabled: Boolean get() = enabled

    fun emit(msg: String) {
        val line = "[GuideDiag] [${iso.format(Date())}] $msg"
        // 단위 테스트(JVM)엔 android.util.Log 스텁이 없을 수 있다 — 실패해도 계측이 기능을 죽이지 않는다.
        runCatching { Log.i(TAG, line) }
        synchronized(lines) {
            lines.addLast(line)
            while (lines.size > maxLines) lines.removeFirst()
        }
        sink?.invoke(line)
    }
}

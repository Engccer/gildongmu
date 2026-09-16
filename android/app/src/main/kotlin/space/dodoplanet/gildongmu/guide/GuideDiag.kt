package space.dodoplanet.gildongmu.guide

import android.content.Context
import android.util.Log
import java.io.File
import java.util.concurrent.Executors
import space.dodoplanet.gildongmu.BuildConfig
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * 도보 안내 세션 계측(spec §8, iOS `GuideDiag`·`DiagFileLog` 대응). 방위 축·워치독·오디오 파라미터를 정하는 유일한 근거라
 * 매 fix의 원시값을 iOS와 같은 줄 형식으로 남긴다(기존 리플레이 스크립트가 그대로 읽는다).
 *
 * 게이트는 `DEBUG || EXPERIMENTAL` — 릴리스는 no-op이고 문자열 조립 자체가 인라인 람다로 건너뛴다. 파일 싱크(앱 전용 외부 저장소
 * `guide-diag.log`, 2MB 교체)는 조각 ④(plan Task 18)가 [sink]에 붙인다. [lines]는 최근 500줄 순환 버퍼(진단·테스트용).
 */
object GuideDiag {
    private const val TAG = "GuideDiag"
    private val enabled = BuildConfig.DEBUG || BuildConfig.EXPERIMENTAL
    private val iso: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)  // 불변 — 스레드 안전

    /** 최근 줄(테스트·진단용 순환 버퍼). */
    val lines: ArrayDeque<String> = ArrayDeque()
    private const val maxLines = 500

    /** 파일 싱크(있으면). 메인에서만 대입·호출한다. */
    var sink: ((String) -> Unit)? = null

    private var fileSinkAttached = false

    /**
     * 파일 싱크 부착(멱등, 전경 서비스 시작 시). 앱 전용 외부 저장소 `guide-diag.log`, 2MB 초과 시 `guide-diag.old.log`로 교체. 쓰기는
     * 단일 스레드 실행기(메인을 막지 않는다). 회수:
     * `adb pull /sdcard/Android/data/space.dodoplanet.gildongmu.dev/files/guide-diag.log ~/gildongmu-private/field-logs/android-<날짜>.log`
     * (정식 번들은 `space.dodoplanet.gildongmu`). 저장소에 커밋하지 않는다(`guide-diag*.log*`).
     */
    fun attachFileSink(context: Context) {
        if (!isEnabled || fileSinkAttached) return
        fileSinkAttached = true
        val app = context.applicationContext
        val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "guide-diag").apply { isDaemon = true } }
        var file: File? = null
        sink = { line ->
            executor.execute {
                runCatching {
                    // 디렉터리 해석(mkdirs·저장소 상태 조회)도 메인 밖에서 — 첫 줄에서 1회.
                    val f = file ?: (app.getExternalFilesDir(null)?.let { File(it, "guide-diag.log") } ?: return@execute).also { file = it }
                    if (f.length() > 2L * 1024 * 1024) {
                        val old = File(f.parentFile, "guide-diag.old.log")
                        old.delete()
                        f.renameTo(old)
                    }
                    f.appendText(line + "\n")
                }
            }
        }
        emit("fileSink attached")
    }

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
        val line = "[GuideDiag] [${iso.format(Instant.now())}] $msg"
        // 단위 테스트(JVM)엔 android.util.Log 스텁이 없을 수 있다 — 실패해도 계측이 기능을 죽이지 않는다.
        runCatching { Log.i(TAG, line) }
        synchronized(lines) {
            lines.addLast(line)
            while (lines.size > maxLines) lines.removeFirst()
        }
        sink?.invoke(line)
    }
}

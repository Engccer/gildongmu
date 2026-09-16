package space.dodoplanet.gildongmu.speech

import android.content.Context
import android.os.Build
import android.speech.SpeechRecognizer

/**
 * 받아쓰기 노출 게이트(D9). 33은 플랫폼 선이 아니라 **정책선**이다 — `createOnDeviceSpeechRecognizer`는 API 31,
 * 언어 지원 조회 `checkRecognitionSupport`가 API 33이고 D9가 그 선을 정책으로 택했다. 조건 미충족이면 버튼·import가 0(게이트 패턴).
 * `RECORD_AUDIO` 선언과 온디바이스 인식기 세션(`DictationSession`)은 M6 몫이고, 검색 화면 마이크 버튼 배선은 그 뒤(M2c/설정 마일스톤).
 */
fun isDictationAvailable(sdkInt: Int, onDeviceProbe: () -> Boolean): Boolean =
    sdkInt >= 33 && onDeviceProbe()

object Dictation {
    fun isAvailable(context: Context): Boolean =
        isDictationAvailable(Build.VERSION.SDK_INT) { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }
}

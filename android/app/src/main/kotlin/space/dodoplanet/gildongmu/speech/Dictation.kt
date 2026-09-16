package space.dodoplanet.gildongmu.speech

import android.content.Context
import android.os.Build
import android.speech.SpeechRecognizer

/**
 * 받아쓰기 노출 게이트(D9). 33은 플랫폼 선이 아니라 **정책선**이다 — `createOnDeviceSpeechRecognizer`는 API 31,
 * 언어 지원 조회 `checkRecognitionSupport`가 API 33이고 D9가 그 선을 정책으로 택했다. 조건 미충족이면 버튼·권한
 * 선언·import 전부 0(게이트 패턴). M1에서는 호출처가 없다(마이크는 후속 마일스톤).
 */
fun isDictationAvailable(sdkInt: Int, onDeviceProbe: () -> Boolean): Boolean =
    sdkInt >= 33 && onDeviceProbe()

object Dictation {
    fun isAvailable(context: Context): Boolean =
        isDictationAvailable(Build.VERSION.SDK_INT) { SpeechRecognizer.isOnDeviceRecognitionAvailable(context) }
}

package space.dodoplanet.gildongmu.nav

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent

/** 처리 앱이 없으면 false(크래시 경로 차단 — 커스텀 안드로이드 기기는 설정 액티비티가 없을 수 있다). */
fun Context.tryStartActivity(intent: Intent): Boolean = try {
    startActivity(intent)
    true
} catch (_: ActivityNotFoundException) {
    false
}

package space.dodoplanet.gildongmu.guide

import android.content.Context
import android.os.PowerManager

/** 전경 판정 입력(§5-3): 앱 Activity STARTED 플래그 + `PowerManager.isInteractive` 실조회. */
class AndroidGuideEnvironment(context: Context) : GuideEnvironment {
    private val power = context.getSystemService(PowerManager::class.java)

    @Volatile var foreground = false
    override fun isForeground(): Boolean = foreground
    override fun isInteractive(): Boolean = power?.isInteractive ?: true
}

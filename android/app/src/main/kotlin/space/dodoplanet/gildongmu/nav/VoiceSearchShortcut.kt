package space.dodoplanet.gildongmu.nav

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.MainActivity
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.speech.Dictation

/**
 * 앱 바로가기 「음성 검색」의 동적 등록. 받아쓰기가 되는 기기(`Dictation.isAvailable` — 받아쓰기 버튼 세션과 같은 술어 한 곳)에만 싣고,
 * 안 되면 같은 id를 거둔다. 정적 선언(`res/xml/shortcuts.xml`)은 「내 주변」 하나만 남는다.
 * 라벨은 앱 언어로 만들므로 액티비티를 만들 때마다 같은 id로 덮어쓴다. 인텐트 대상은 클래스로 지정해 실험판(.dev)에서도 맞다.
 */
object VoiceSearchShortcut {
    const val ID = "voiceSearch"

    fun sync(context: Context) {
        val manager = context.getSystemService(ShortcutManager::class.java) ?: return
        if (Dictation.isAvailable(context)) {
            val res = AppConfig.localizedApp()
            val info = ShortcutInfo.Builder(context, ID)
                .setShortLabel(res.getString(R.string.android_shortcut_voiceSearch_title))
                .setLongLabel(res.getString(R.string.android_shortcut_voiceSearch_desc))
                .setIcon(Icon.createWithResource(context, R.mipmap.ic_launcher))
                .setIntent(Intent(context, MainActivity::class.java).setAction(AppSession.ACTION_VOICE_SEARCH))
                .build()
            manager.pushDynamicShortcut(info)
        } else {
            manager.removeDynamicShortcuts(listOf(ID))
        }
    }
}

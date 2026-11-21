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
 * - id는 옛 정적 바로가기(`voiceSearch`)와 다르다: 그것을 홈 화면에 고정한 기기에는 비활성·불변 사본이 남아 같은 id의 동적 등록이 예외로 막힌다.
 * - `NEW_TASK | CLEAR_TASK`를 직접 붙인다: 정적 바로가기는 시스템이 붙이지만 동적은 아니다(앱이 떠 있으면 `onNewIntent`로 들어온다). 「내 주변」과 같은 진입으로 맞춘다.
 */
object VoiceSearchShortcut {
    const val ID = "voiceSearchDynamic"

    fun sync(context: Context) {
        val manager = context.getSystemService(ShortcutManager::class.java) ?: return
        if (Dictation.isAvailable(context)) {
            val res = AppConfig.localizedApp()
            val info = ShortcutInfo.Builder(context, ID)
                .setShortLabel(res.getString(R.string.android_shortcut_voiceSearch_title))
                .setLongLabel(res.getString(R.string.android_shortcut_voiceSearch_desc))
                .setIcon(Icon.createWithResource(context, R.mipmap.ic_launcher))
                .setIntent(Intent(context, MainActivity::class.java).setAction(AppSession.ACTION_VOICE_SEARCH).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
                .build()
            manager.pushDynamicShortcut(info)
        } else {
            manager.removeDynamicShortcuts(listOf(ID))
        }
    }
}

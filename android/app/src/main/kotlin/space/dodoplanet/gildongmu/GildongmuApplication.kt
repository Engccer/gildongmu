package space.dodoplanet.gildongmu

import android.app.Application
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** 앱 컨텍스트를 `AppConfig` 싱글턴에 준다(위치 스토어·권한 게이트가 프로세스 수명). */
class GildongmuApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AppConfig.attach(this)
        // 수동 위치 hydration(디스크 I/O) — `current`를 읽는 suspend 경로는 전부 `awaitHydrated()` 뒤에 읽는다(spec §13-1 불변식).
        AppConfig.appScope.launch(Dispatchers.IO) { AppConfig.manualLocationStore.hydrate() }
    }
}

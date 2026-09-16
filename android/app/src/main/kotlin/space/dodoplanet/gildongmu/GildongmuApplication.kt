package space.dodoplanet.gildongmu

import android.app.Application

/** 앱 컨텍스트를 `AppConfig` 싱글턴에 준다(위치 스토어·권한 게이트가 프로세스 수명). */
class GildongmuApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        AppConfig.attach(this)
    }
}

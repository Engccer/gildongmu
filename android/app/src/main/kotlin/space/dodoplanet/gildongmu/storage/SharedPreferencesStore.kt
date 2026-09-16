package space.dodoplanet.gildongmu.storage

import android.content.Context
import space.dodoplanet.gildongmu.kit.KeyValueStore

/**
 * `KeyValueStore`의 안드로이드 구현([3] 실행 계층). 기본 파일 `gildongmu` 하나에 최근 검색(:kit `RecentSearchStore` JSON, 키는 iOS
 * UserDefaults와 같다 — `recentQueries.v2` 등)·수동 위치·설정이 함께 든다(iOS `UserDefaults.standard` 동형; 채팅 AI 동의는 M6의 별도 파일).
 * 첫 읽기(디스크 로드)는 `Dispatchers.IO`에서 — 예외는 `MainActivity.attachBaseContext`의 설정 언어 키 동기 읽기 하나로, 그 한 번이 파일
 * 전체를 로드한다(spec §14-1 수용). 그 뒤 읽기는 메모리 캐시·쓰기는 `apply`(비동기)라 main에서 불러도 된다.
 */
class SharedPreferencesStore(context: Context, name: String = "gildongmu") : KeyValueStore {
    private val prefs = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun getString(key: String): String? = prefs.getString(key, null)
    override fun putString(key: String, value: String) { prefs.edit().putString(key, value).apply() }
}

package space.dodoplanet.gildongmu.storage

import android.content.Context
import space.dodoplanet.gildongmu.kit.KeyValueStore

/**
 * `KeyValueStore`의 안드로이드 구현([3] 실행 계층). 값은 :kit `RecentSearchStore`가 만든 JSON 문자열이고
 * 키 이름은 iOS UserDefaults와 같다(`recentQueries.v2` 등). 첫 읽기(디스크 로드)는 호출자가 `Dispatchers.IO`에서 부르고,
 * 그 뒤 읽기는 메모리 캐시·쓰기는 `apply`(비동기)라 main에서 불러도 된다(`SearchViewModel` 계약).
 */
class SharedPreferencesStore(context: Context, name: String = "gildongmu.recent") : KeyValueStore {
    private val prefs = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun getString(key: String): String? = prefs.getString(key, null)
    override fun putString(key: String, value: String) { prefs.edit().putString(key, value).apply() }
}

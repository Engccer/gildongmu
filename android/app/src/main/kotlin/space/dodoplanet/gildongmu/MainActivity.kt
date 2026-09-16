package space.dodoplanet.gildongmu

import android.content.res.Resources
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.search.SearchScreen
import space.dodoplanet.gildongmu.search.SearchStrings
import space.dodoplanet.gildongmu.search.SearchViewModel
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore

/** 단일 액티비티. M1은 검색 화면 하나(탭·내비게이션은 M2에서). */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val factory = viewModelFactory {
            initializer {
                SearchViewModel(
                    service = SearchService(AppConfig.apiClient),
                    store = RecentSearchStore(SharedPreferencesStore(applicationContext)),
                    dataLocale = { AppLocale.dataLocale(resources) },
                    strings = searchStrings(resources),
                    savedState = createSavedStateHandle(),
                )
            }
        }
        setContent {
            MaterialTheme {
                SearchScreen(viewModel(factory = factory))
            }
        }
    }
}

/** ViewModel 통지 문장(리소스는 화면 몫, spec §4). */
fun searchStrings(res: Resources): SearchStrings = SearchStrings(
    searchingFor = { appLocalized(res, R.string.search_searchingFor, it) },
    failed = res.getString(R.string.android_search_announceFailed),
    empty = res.getString(R.string.android_search_announceEmpty),
    count = { appLocalized(res, R.string.android_search_announceCount, it) },
    deleted = res.getString(R.string.recent_deleted),
    cleared = res.getString(R.string.recent_cleared),
    clearedExceptPinned = res.getString(R.string.recent_clearedExceptPinned),
)

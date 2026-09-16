package space.dodoplanet.gildongmu.directions

import android.content.Context
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import space.dodoplanet.gildongmu.AppConfig
import space.dodoplanet.gildongmu.i18n.AppLocale
import space.dodoplanet.gildongmu.kit.RecentSearchStore
import space.dodoplanet.gildongmu.kit.RouteService
import space.dodoplanet.gildongmu.kit.SearchService
import space.dodoplanet.gildongmu.storage.SharedPreferencesStore

/**
 * 길찾기 ViewModel 팩토리 — 이 패키지가 앱 컨텍스트로 스스로 만든다(`MainActivity`는 골격 세션 소유, spec §2).
 * ⚠ Activity를 캡처하지 않는다(ViewModel은 구성 변경을 넘어 산다). 문자열·언어는 호출 시점에 읽어 앱별 언어 변경을 따라간다.
 */
fun directionsViewModelFactory(context: Context): ViewModelProvider.Factory {
    val app = context.applicationContext
    return viewModelFactory {
        initializer {
            DirectionsViewModel(
                routes = RouteService(AppConfig.apiClient),
                search = SearchService(AppConfig.apiClient),
                store = RecentSearchStore(SharedPreferencesStore(app)),
                locator = directionsLocator(),
                dataLocale = { AppLocale.dataLocale(app.resources) },
                strings = resourceStrings(app.resources),
                savedState = createSavedStateHandle(),
                manual = { AppConfig.manualLocationStore.current.value },
                verdict = { AppConfig.manualLocationStore.verdict.value },
            )
        }
    }
}

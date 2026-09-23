package space.dodoplanet.gildongmu.directions

import android.content.Context
import android.content.res.Resources
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
 * ⚠ Activity를 캡처하지 않는다(ViewModel은 구성 변경을 넘어 산다). 문자열·언어는 **호출 시점**에 `AppConfig.localizedApp()`에서 읽는다(spec §14-2 —
 * 앱 컨텍스트의 `Resources`는 오버라이드를 받지 않으므로 캡처하면 옛 언어로 굳는다).
 */
fun directionsViewModelFactory(context: Context): ViewModelProvider.Factory {
    val res: () -> Resources = { AppConfig.localizedApp().resources }
    val store = RecentSearchStore(SharedPreferencesStore(context))
    return viewModelFactory {
        initializer {
            DirectionsViewModel(
                routes = RouteService(AppConfig.apiClient),
                search = SearchService(AppConfig.apiClient),
                store = store,
                locator = directionsLocator(),
                dataLocale = { AppLocale.dataLocale(res()) },
                strings = resourceStrings(res),
                savedState = createSavedStateHandle(),
                manual = { AppConfig.manualLocationStore.current.value },
                verdict = { AppConfig.manualLocationStore.verdict.value },
                staleChanges = AppConfig.effectiveLocation.staleChanges,
            )
        }
    }
}

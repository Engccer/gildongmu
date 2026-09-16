package space.dodoplanet.gildongmu.nearby

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import space.dodoplanet.gildongmu.kit.ManualLocation
import space.dodoplanet.gildongmu.kit.NearbyCoordinateSource
import space.dodoplanet.gildongmu.kit.NearbyService

/** kind별 ViewModel 팩토리. 앵커가 있으면 `Fixed`(측위 없음), 없으면 위치 스토어 어댑터(`Current`). */
fun nearbyFactory(
    kind: NearbyKind,
    anchor: PlaceAnchor?,
    services: NearbyServices,
    strings: NearbyStrings,
    current: () -> NearbyCoordinateSource,
    manual: () -> ManualLocation?,
): ViewModelProvider.Factory {
    val service = services.nearby
    val coordinate = anchor?.let { NearbyCoordinateSource.Fixed(it.coord) } ?: current()
    return viewModelFactory {
        initializer {
            val handle = createSavedStateHandle()
            when (kind) {
                NearbyKind.around -> NearbyScreenViewModel(NearbyKinds.around(service, strings, manual), coordinate, strings, handle, manual)
                NearbyKind.subway -> NearbyScreenViewModel(NearbyKinds.subway(service, strings), coordinate, strings, handle, manual)
                NearbyKind.bus -> NearbyScreenViewModel(NearbyKinds.bus(service, strings), coordinate, strings, handle, manual)
                NearbyKind.bike -> NearbyScreenViewModel(NearbyKinds.bike(service, strings), coordinate, strings, handle, manual)
                NearbyKind.clinic -> NearbyScreenViewModel(NearbyKinds.clinic(service, strings), coordinate, strings, handle, manual)
                NearbyKind.barrierFree -> NearbyScreenViewModel(NearbyKinds.barrierFree(services.barrierFree, strings), coordinate, strings, handle, manual)
                NearbyKind.kids -> NearbyScreenViewModel(NearbyKinds.kids(service, strings), coordinate, strings, handle, manual)
                NearbyKind.events -> NearbyScreenViewModel(NearbyKinds.events(service, strings), coordinate, strings, handle, manual)
                NearbyKind.walkInfra -> NearbyScreenViewModel(NearbyKinds.walkInfra(services.walkInfra, strings, services.shortTimeNow), coordinate, strings, handle, manual)
                NearbyKind.conditions -> NearbyScreenViewModel(NearbyKinds.conditions(services.conditions, strings), coordinate, strings, handle, manual)
            }
        }
    }
}

fun busRouteStopsFactory(route: BusRouteStopsRoute, service: NearbyService, strings: NearbyStrings): ViewModelProvider.Factory = viewModelFactory {
    initializer {
        NearbyScreenViewModel(
            NearbyKinds.busRouteStops(service, strings, route.source, route.cityCode, route.routeId),
            NearbyCoordinateSource.None, strings, createSavedStateHandle(),
        )
    }
}

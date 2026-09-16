package space.dodoplanet.gildongmu.place

import android.content.res.Resources
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.BarrierFreeService
import space.dodoplanet.gildongmu.kit.PlaceHoursService
import space.dodoplanet.gildongmu.kit.StationService
import space.dodoplanet.gildongmu.kit.models.Place

/** 호출 시점에 `res()`를 읽는다(spec §14-2). */
fun placeStrings(res: () -> Resources): PlaceStrings {
    return PlaceStrings(
        copied = { res().getString(R.string.place_addressCopied) },
        noAppToOpen = { res().getString(R.string.android_common_noAppToOpen) },
        hoursLine = { appLocalized(res(), R.string.placeHours_line, it) },
        allDay = { res().getString(R.string.placeHours_allDay) },
        closed = { res().getString(R.string.placeHours_closed) },
        nextDay = { appLocalized(res(), R.string.placeHours_nextDay, it) },
    )
}

fun placeDetailFactory(
    place: Place,
    hours: PlaceHoursService,
    strings: PlaceStrings,
    station: StationService,
    barrierFree: BarrierFreeService,
    dataLocale: () -> String,
): ViewModelProvider.Factory = viewModelFactory { initializer { PlaceDetailViewModel(place, hours, strings, station, barrierFree, dataLocale) } }

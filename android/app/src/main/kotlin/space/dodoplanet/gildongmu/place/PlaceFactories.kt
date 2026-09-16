package space.dodoplanet.gildongmu.place

import android.content.Context
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import space.dodoplanet.gildongmu.R
import space.dodoplanet.gildongmu.i18n.appLocalized
import space.dodoplanet.gildongmu.kit.BarrierFreeService
import space.dodoplanet.gildongmu.kit.PlaceHoursService
import space.dodoplanet.gildongmu.kit.StationService
import space.dodoplanet.gildongmu.kit.models.Place

fun placeStrings(context: Context): PlaceStrings {
    val res = context.resources
    return PlaceStrings(
        copied = { context.getString(R.string.place_addressCopied) },
        noAppToOpen = { context.getString(R.string.android_common_noAppToOpen) },
        hoursLine = { appLocalized(res, R.string.placeHours_line, it) },
        allDay = { context.getString(R.string.placeHours_allDay) },
        closed = { context.getString(R.string.placeHours_closed) },
        nextDay = { appLocalized(res, R.string.placeHours_nextDay, it) },
    )
}

fun placeDetailFactory(
    place: Place,
    hours: PlaceHoursService,
    strings: PlaceStrings,
    station: StationService? = null,
    barrierFree: BarrierFreeService? = null,
    dataLocale: () -> String = { "ko" },
): ViewModelProvider.Factory = viewModelFactory { initializer { PlaceDetailViewModel(place, hours, strings, station, barrierFree, dataLocale) } }

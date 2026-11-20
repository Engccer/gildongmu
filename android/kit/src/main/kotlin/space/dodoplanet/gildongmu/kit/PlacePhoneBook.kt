package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import java.util.Locale

/** 목적지 전화번호부의 한 줄(E90). 열쇠는 이름 + 좌표 소수 4자리(`RecentEndpoint`의 동일 판정과 같은 축)다. */
@Serializable
data class PlacePhoneEntry(val label: String, val lat: Double, val lng: Double, val phone: String)

/**
 * 안내 목적지의 전화번호부(E90 「안내 시트의 목적지에 전화 걸기」, Swift `PlacePhoneBook` 미러) — 기기 로컬 전용(`KeyValueStore`).
 *
 * 안내 세션은 목적지를 이름과 좌표로만 든다. 번호는 **목적지를 고르는 자리**가 그때 손에 든 값을 `note`로 적고, 안내 시트가 제목의
 * 이름·좌표로 `phone`을 찾는다. 안내 세션에는 번호를 태우지 않는다. 제목이 승차 정류장·환승역으로 바뀐 세션은 열쇠가 맞지 않아 번호가 없다.
 *
 * null·빈 번호는 적지 않고 지우지도 않는다 — 앱의 `Place`는 투영마다 번호를 비워 두므로 빈 값은 "이 원천은 모른다"일 수 있다.
 * 열쇠 불일치는 null이고 호출부는 전화 동작을 세우지 않는다(죽은 동작 금지, 다른 장소의 번호를 붙이지 않는다).
 */
class PlacePhoneBook(private val store: KeyValueStore) {
    companion object {
        const val cap = 200
        internal const val storageKey = "placePhoneBook.v1"

        /** 번호를 적은 새 목록(최신이 앞, `cap` 초과분은 오래된 것부터 버린다). null·빈 값이면 그대로. */
        internal fun noted(entries: List<PlacePhoneEntry>, label: String, lat: Double, lng: Double, phone: String?): List<PlacePhoneEntry> {
            val trimmed = phone?.trimSwiftWhitespacesAndNewlines() ?: ""
            if (trimmed.isEmpty()) return entries
            val key = key(label, lat, lng)
            val rest = entries.filter { key(it.label, it.lat, it.lng) != key }
            return (listOf(PlacePhoneEntry(label, lat, lng, trimmed)) + rest).take(cap)
        }

        internal fun phone(entries: List<PlacePhoneEntry>, label: String, lat: Double, lng: Double): String? {
            val key = key(label, lat, lng)
            return entries.firstOrNull { key(it.label, it.lat, it.lng) == key }?.phone
        }

        /** 이름 + 좌표 4자리(≈11m). 이름까지 보는 것은 같은 건물의 다른 가게 번호를 붙이지 않기 위해서다. */
        internal fun key(label: String, lat: Double, lng: Double): String =
            "$label|" + String.format(Locale.ROOT, "%.4f,%.4f", lat, lng)
    }

    /** 그 장소의 번호를 적는다. null·빈 값이면 아무것도 하지 않는다. */
    fun note(label: String, lat: Double, lng: Double, phone: String?) {
        val current = entries()
        val next = noted(current, label, lat, lng, phone)
        if (next !== current) save(next)
    }

    /** 그 이름·좌표로 적힌 번호. 없으면 null. */
    fun phone(label: String, lat: Double, lng: Double): String? = phone(entries(), label, lat, lng)

    private val serializer: KSerializer<List<PlacePhoneEntry>> = ListSerializer(PlacePhoneEntry.serializer())

    private fun entries(): List<PlacePhoneEntry> {
        val raw = store.getString(storageKey) ?: return emptyList()
        return try {
            KitJson.decodeFromString(serializer, raw)
        } catch (_: SerializationException) {
            emptyList()
        } catch (_: IllegalArgumentException) {
            emptyList()
        }
    }

    private fun save(entries: List<PlacePhoneEntry>) {
        store.putString(storageKey, KitJson.encodeToString(serializer, entries))
    }
}

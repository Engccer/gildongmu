package space.dodoplanet.gildongmu.location

import space.dodoplanet.gildongmu.kit.KeyValueStore

// 위치 계층 테스트 페이크(플랫폼은 페이크, 구독 콜백을 테스트가 직접 부른다, 시간은 가상 시계). `LocationStoreTest`·`ManualLocationJudgeTest`·`EffectiveLocationTest` 공유.

internal class FakeSource(var enabled: Boolean = true, val providers: Set<String> = setOf(LocationSource.FUSED)) : LocationSource {
    var now = 100_000L
    val listeners = LinkedHashMap<String, (RawFix) -> Unit>()
    var closed = 0
    var subscriptions = 0
    override fun isLocationEnabled() = enabled
    override fun hasProvider(name: String) = name in providers
    override fun subscribe(provider: String, onFix: (RawFix) -> Unit): AutoCloseable {
        subscriptions++
        listeners[provider] = onFix
        return AutoCloseable { closed++; listeners.remove(provider) }
    }
    override fun elapsedRealtimeMs() = now
    fun emit(accuracy: Double, ageSeconds: Double = 0.0, lat: Double = 37.5, lng: Double = 127.1) {
        val fix = RawFix(lat, lng, accuracy, now - (ageSeconds * 1000).toLong())
        listeners.values.toList().forEach { it(fix) }
    }
}

internal class FakeGate(var value: LocationPermission, private val afterRequest: LocationPermission = value) : PermissionGate {
    var requests = 0
    override fun current() = value
    override suspend fun request(): LocationPermission { requests++; value = afterRequest; return value }
}

internal class MemStore : KeyValueStore {
    val map = HashMap<String, String>()
    override fun getString(key: String) = map[key]
    override fun putString(key: String, value: String) { map[key] = value }
}

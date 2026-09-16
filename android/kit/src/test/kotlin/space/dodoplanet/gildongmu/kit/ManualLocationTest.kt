package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.Serializable
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 수동 위치 판정 — Kit `ManualLocationTests` 미러. 웹 정본과 같은 공유 fixture(`manual-location-scenarios.json`)를
 * 소비해 판정이 갈리지 않게 한다(드리프트 가드). Kit의 `안내_모델이_수동_위치를_참조하지_않는다`는 iOS 앱
 * `BeaconModel.swift` 소스 가드라 :kit 몫이 아니다(안드로이드 안내 모델은 :app M4가 같은 가드를 단다).
 */
class ManualLocationTest {
    @Serializable
    private data class Scenarios(val cases: List<Case>) {
        @Serializable data class FixJSON(val lat: Double, val lng: Double, val accuracy: Double, val at: Double)

        @Serializable
        data class ManualJSON(val revision: Int, val label: String, val lat: Double, val lng: Double, val origin: FixJSON? = null, val setAt: Double)

        @Serializable
        data class Case(val name: String, val manual: ManualJSON, val fix: FixJSON? = null, val now: Double, val expect: String)
    }

    private fun toFix(f: Scenarios.FixJSON) = ManualFix(f.lat, f.lng, f.accuracy, f.at)

    @Test fun `공유 fixture로 웹과 같은 판정을 낸다`() {
        val scenarios = Fixtures.sharedJson("manual-location-scenarios.json", Scenarios.serializer())
        assertTrue(scenarios.cases.size >= 10)
        for (c in scenarios.cases) {
            val manual = ManualLocation(
                revision = c.manual.revision, label = c.manual.label, lat = c.manual.lat, lng = c.manual.lng,
                origin = c.manual.origin?.let(::toFix), setAt = c.manual.setAt,
            )
            val verdict = judgeManualLocation(manual, c.fix?.let(::toFix), c.now)
            assertEquals(c.expect, verdict.rawValue, c.name)
        }
    }

    @Test fun `상수가 웹과 같고 두 축이 분리돼 있다`() {
        assertEquals(100.0, ManualLocationPolicy.movedMeters)
        assertEquals(100.0, ManualLocationPolicy.judgeCeilingMeters)
        assertEquals(10.0, ManualLocationPolicy.fixMaxAgeSeconds)
    }

    /**
     * 라벨 판정선(I1): `origin` 유무만 보면 **지금** 판정 불가한 상태가 검증 가능형으로 낭독된다 — 더 나쁜 상태가
     * 더 안심시키는 라벨을 내는 역전. 웹 `isManualLocationVerified`와 같은 표를 만족해야 한다.
     */
    @Test fun `검증 가능형 라벨은 origin과 마지막 판정을 모두 본다`() {
        val withOrigin = ManualLocation(revision = 1, label = "길동 카페", lat = 37.5384, lng = 127.1432, origin = ManualFix(37.5384, 127.1432, 10.0, 1.0), setAt = 1.0)
        val withoutOrigin = ManualLocation(revision = 1, label = "길동 카페", lat = 37.5384, lng = 127.1432, origin = null, setAt = 1.0)
        // origin 있음 × 판정 전(null)·keep → 검증 가능형
        assertTrue(isManualLocationVerified(withOrigin, null))
        assertTrue(isManualLocationVerified(withOrigin, ManualVerdict.keep))
        // origin 있음 × undecidable(권한 철회·측위 실패) → 검증 불가형
        assertFalse(isManualLocationVerified(withOrigin, ManualVerdict.undecidable))
        // origin 없음 → 어떤 판정에서도 검증 불가형
        assertFalse(isManualLocationVerified(withoutOrigin, null))
        assertFalse(isManualLocationVerified(withoutOrigin, ManualVerdict.keep))
        assertFalse(isManualLocationVerified(withoutOrigin, ManualVerdict.undecidable))
    }

    /** 라틴 표기(`labelRoman`, E28)는 additive다 — 저장소의 옛 값(키 부재)은 null로 읽히고, 있으면 왕복이 보존한다. */
    @Test fun `라틴 표기는 선택 필드라 옛 저장값도 읽힌다`() {
        val legacy = """{"revision":1,"label":"강동구청","lat":37.53,"lng":127.12,"origin":null,"setAt":1}"""
        val decoded = KitJson.decodeFromString(ManualLocation.serializer(), legacy)
        assertNull(decoded.labelRoman)
        assertEquals("강동구청", decoded.label)

        val withRoman = ManualLocation(revision = 2, label = "강동구청", labelRoman = "Gangdong-gu Office", lat = 37.53, lng = 127.12, origin = null, setAt = 2.0)
        val roundTrip = KitJson.decodeFromString(ManualLocation.serializer(), KitJson.encodeToString(ManualLocation.serializer(), withRoman))
        assertEquals(withRoman, roundTrip)
        assertEquals("Gangdong-gu Office", roundTrip.labelRoman)
    }

    /** 비-ko 낭독은 라틴 표기가 1순위(웹 `useManualLocationBilingual` 미러), ko와 표기 부재는 한글 그대로. */
    @Test fun `비ko 낭독은 라틴 표기가 1순위다`() {
        val withRoman = ManualLocation(revision = 1, label = "강동구청", labelRoman = "Gangdong-gu Office", lat = 37.53, lng = 127.12, origin = null, setAt = 1.0)
        val en = manualLocationBilingualName(withRoman, "en")
        assertEquals("Gangdong-gu Office", en.primary)
        assertEquals("강동구청", en.secondary)
        assertEquals("Gangdong-gu Office (강동구청)", en.display)
        // ko는 병기 없음(byte-identical).
        assertEquals(BilingualName("강동구청", null), manualLocationBilingualName(withRoman, "ko"))
        // 표기가 없으면 비-ko도 한글 그대로(거짓 로마자를 만들지 않는다).
        val bare = ManualLocation(revision = 1, label = "강동구청", lat = 37.53, lng = 127.12, origin = null, setAt = 1.0)
        assertEquals(BilingualName("강동구청", null), manualLocationBilingualName(bare, "en"))
    }

    /** 무효 fix(0 이하·NaN 정확도, 범위 밖 좌표, 나이 초과)는 판정 자격이 없다(Kit 테스트 없음 — 공유 fixture 밖 경계 보강). */
    @Test fun ineligibleFixesAreUndecidable() {
        val manual = ManualLocation(revision = 1, label = "a", lat = 37.5, lng = 127.0, origin = ManualFix(37.5, 127.0, 10.0, 0.0), setAt = 0.0)
        for (fix in listOf(
            ManualFix(37.5, 127.0, -1.0, 100.0),
            ManualFix(37.5, 127.0, Double.NaN, 100.0),
            ManualFix(91.0, 127.0, 10.0, 100.0),
            ManualFix(37.5, 127.0, 10.0, 89.0),
        )) {
            assertEquals(ManualVerdict.undecidable, judgeManualLocation(manual, fix, now = 100.0), fix.toString())
        }
        assertEquals(ManualVerdict.keep, judgeManualLocation(manual, ManualFix(37.5, 127.0, 10.0, 90.0), now = 100.0))
    }
}

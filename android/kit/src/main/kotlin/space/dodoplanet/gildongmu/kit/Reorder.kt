package space.dodoplanet.gildongmu.kit

import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer

/**
 * 순서 바꾸기 판정 — Kit `Reorder.swift` 미러(E67 고정 항목 순서·E66 탭 순서, spec 2026-10-05-reorder-rotor-actions-design.md §1·§3.1).
 * 안드로이드 화면 이식(TalkBack 동작 메뉴)은 iOS 실기기 판정 뒤다. 엔트리 이름은 Swift 케이스 이름 그대로다.
 */
enum class ReorderMove { toTop, up, down }

object Reorder {
    /** 그 자리에서 할 수 있는 이동, 위에서 아래 순(맨 위로, 위로, 아래로). 항목이 2개 미만이면 없다. */
    fun availableMoves(index: Int, count: Int): List<ReorderMove> {
        if (count < 2 || index < 0 || index >= count) return emptyList()
        val moves = mutableListOf<ReorderMove>()
        if (index >= 2) moves += ReorderMove.toTop
        if (index >= 1) moves += ReorderMove.up
        if (index < count - 1) moves += ReorderMove.down
        return moves
    }

    /** 한 항목을 옮긴 새 목록. 범위 밖이거나 옮길 수 없는 이동은 원본 그대로. */
    fun <T> moved(items: List<T>, from: Int, move: ReorderMove): List<T> {
        if (from !in items.indices) return items
        val target = when (move) {
            ReorderMove.toTop -> 0
            ReorderMove.up -> from - 1
            ReorderMove.down -> from + 1
        }
        if (target !in items.indices || target == from) return items
        val out = items.toMutableList()
        val item = out.removeAt(from)
        out.add(target, item)
        return out
    }

    /** 저장된 순서의 복구: 기본 순서에 있는 값만 처음 한 번씩 앞에서부터 남기고, 빠진 값은 기본 순서대로 뒤에 붙인다. */
    fun restoredOrder(saved: List<String>, defaultOrder: List<String>): List<String> {
        val seen = mutableSetOf<String>()
        val known = defaultOrder.toSet()
        val kept = saved.filter { it in known && seen.add(it) }
        return kept + defaultOrder.filter { it !in seen }
    }

    /** 저장 문자열(JSON 배열) 판. 파싱 실패·빈 값은 기본 순서다(Swift `restoredOrder(json:)`). */
    fun restoredOrder(json: String, defaultOrder: List<String>): List<String> {
        val saved = try {
            KitJson.decodeFromString(ListSerializer(String.serializer()), json)
        } catch (_: SerializationException) {
            emptyList()
        } catch (_: IllegalArgumentException) {
            emptyList()
        }
        return restoredOrder(saved, defaultOrder)
    }

    /** 저장 문자열로 쓰기(`restoredOrder(json)`의 짝). */
    fun encodedOrder(order: List<String>): String =
        KitJson.encodeToString(ListSerializer(String.serializer()), order)

    /** 저장할 값: 기본 순서와 같으면 빈 문자열(미지정), 다르면 JSON 배열(Swift `storedValue`). */
    fun storedValue(order: List<String>, defaultOrder: List<String>): String =
        if (order == defaultOrder) "" else encodedOrder(order)
}

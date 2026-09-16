package space.dodoplanet.gildongmu.kit

import java.net.URLDecoder

/** URL의 쿼리 항목(디코딩된 이름·값 쌍, 순서 보존) — Swift 테스트의 `URLComponents(...).queryItems` 대응. */
fun queryItemsOf(url: String): List<QueryItem> =
    queryOf(url).split("&").filter { it.isNotEmpty() }.map {
        val (name, value) = it.split("=", limit = 2)
        URLDecoder.decode(name, "UTF-8") to URLDecoder.decode(value, "UTF-8")
    }

/** 마지막으로 보낸 요청의 쿼리 항목. */
fun StubTransport.lastQuery(): List<QueryItem> = queryItemsOf(seenUrls.last())

fun List<QueryItem>.has(name: String, value: String): Boolean = any { it.first == name && it.second == value }

fun List<QueryItem>.hasName(name: String): Boolean = any { it.first == name }

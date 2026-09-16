package space.dodoplanet.gildongmu.directions

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import space.dodoplanet.gildongmu.kit.Fixtures
import space.dodoplanet.gildongmu.kit.pluralCategory

/**
 * 테스트용 `Strings` — 카탈로그 JSON(`messages/{lang}.json` + `ios/i18n/ios-extra`(`ios.*`를 `android.*`로도) +
 * `android/i18n/android-extra`)을 직접 읽어 **실제 문장**으로 단언한다. 인자는 ko 플레이스홀더 등장 순서(생성
 * 스크립트와 같은 ABI). ICU 복수 블록은 `pluralCategory`로 갈래를 고르고 `#`을 값으로 바꾼다. 키가 없으면 실패한다
 * (조용히 키 문자열을 돌려주면 매핑 누락이 초록으로 지나간다).
 */
class CatalogStrings(private val lang: String) : Strings {
    private val ko: Map<String, String> = load("ko")
    private val target: Map<String, String> = if (lang == "ko") ko else load(lang)

    private fun load(l: String): Map<String, String> {
        val root = Fixtures.repoRoot
        val out = LinkedHashMap<String, String>()
        flatten(Json.parseToJsonElement(root.resolve("messages/$l.json").readText()).jsonObject, "", out)
        val ios = LinkedHashMap<String, String>()
        flatten(Json.parseToJsonElement(root.resolve("ios/i18n/ios-extra/$l.json").readText()).jsonObject, "", ios)
        for ((k, v) in ios) {
            out[k] = v
            if (k.startsWith("ios.")) out["android." + k.removePrefix("ios.")] = v
        }
        flatten(Json.parseToJsonElement(root.resolve("android/i18n/android-extra/$l.json").readText()).jsonObject, "", out)
        return out
    }

    private fun flatten(obj: JsonObject, prefix: String, out: MutableMap<String, String>) {
        for ((k, v) in obj) {
            val key = if (prefix.isEmpty()) k else "$prefix.$k"
            when (v) {
                is JsonObject -> flatten(v, key, out)
                is JsonPrimitive -> out[key] = v.content
                else -> Unit
            }
        }
    }

    override fun get(key: String, vararg args: Any): String {
        val template = target[key] ?: ko[key] ?: error("카탈로그에 없는 키: $key")
        val order = PLACEHOLDER.findAll(ko[key] ?: template).map { it.groupValues[1] }.distinct().toList()
        check(order.size == args.size) { "$key 인자 수 불일치: ko 순서 $order, 받은 ${args.toList()}" }
        val values = order.zip(args.map { it.toString() }).toMap()
        var text = resolvePlurals(template, values)
        for ((name, value) in values) text = text.replace("{$name}", value)
        return text
    }

    /** `{name, plural, one {…} other {…}}` — 중괄호 균형으로 블록을 잘라 갈래를 고른다. */
    private fun resolvePlurals(template: String, values: Map<String, String>): String {
        var text = template
        while (true) {
            val m = PLURAL_HEAD.find(text) ?: return text
            val name = m.groupValues[1]
            var depth = 1
            var i = m.range.last + 1
            while (i < text.length && depth > 0) {
                when (text[i]) { '{' -> depth++; '}' -> depth-- }
                i++
            }
            val body = text.substring(m.range.last + 1, i - 1)
            val branches = LinkedHashMap<String, String>()
            val branchRe = Regex("""([A-Za-z=0-9]+)[ ]*\{""")
            var pos = 0
            while (true) {
                val b = branchRe.find(body, pos) ?: break
                var d = 1
                var j = b.range.last + 1
                while (j < body.length && d > 0) {
                    when (body[j]) { '{' -> d++; '}' -> d-- }
                    j++
                }
                branches[b.groupValues[1]] = body.substring(b.range.last + 1, j - 1)
                pos = j
            }
            val n = values[name]?.toIntOrNull() ?: 0
            val chosen = branches["=$n"] ?: branches[pluralCategory(n, lang)] ?: branches["other"] ?: ""
            text = text.substring(0, m.range.first) + chosen.replace("#", n.toString()) + text.substring(i)
        }
    }

    private companion object {
        val PLACEHOLDER = Regex("""\{([A-Za-z0-9_]+)(?:,[^}]*)?\}""")
        val PLURAL_HEAD = Regex("""\{([A-Za-z0-9_]+),[ ]*plural,[ ]*""")
    }
}

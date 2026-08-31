import { describe, it, expect } from "vitest";
import { routing } from "@/i18n/routing";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import itMessages from "../../../messages/it.json";
import ja from "../../../messages/ja.json";

/**
 * 모든 로케일 메시지가 ko(기준)와 (1) 동일한 키 집합 (2) 키마다 동일한 ICU
 * 플레이스홀더·t.rich 태그 토큰을 갖는지 강제한다. 새 언어 추가나 키 수정 시
 * 누락·플레이스홀더 변형으로 인한 런타임 에러를 머지 전에 잡는 게이트다.
 */
const MESSAGES: Record<string, unknown> = { ko, en, es, fr, it: itMessages, ja };

/**
 * 비-ko 로케일에 한글이 남아도 되는 키. 언어 선택 메뉴는 각 언어를 **자국어
 * 표기**로 보여 주므로(국기 이모지 금지 규칙의 짝) 한국어 항목은 어느 로케일에서도
 * "한국어"다. 예외를 늘릴 때는 "그 언어 사용자에게 한글이 보이는 것이 옳은가"로
 * 판정한다 — 번역 누락은 이 목록이 아니라 번역으로 해결한다.
 */
const HANGUL_ALLOWED = new Set(["nav.korean"]);

function flatten(obj: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, path));
    } else {
      out[path] = String(v);
    }
  }
  return out;
}

/**
 * ICU 인자 이름 집합 {xxx}와 빈 태그 <xxx>(정렬). 인자는 `{name}`(단순)과
 * `{name, plural, one {…} other {…}}`(A29 복수형) 둘 다 `{` 뒤 식별자가 `,`나
 * `}`로 닫히는 형태라 한 정규식으로 잡힌다 — 분기 안 `#`은 인자가 아니고 분기
 * 안 중첩 `{name}`은 그대로 수집된다. 게이트의 뜻은 **인자 집합** 동일성이지
 * plural 사용 여부가 아니다(ko `{count}` ↔ en `{count, plural…}`는 같은 집합).
 */
function tokens(s: string): string[] {
  const placeholders = [...s.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?=[,}])/g)].map((m) => `{${m[1]}}`);
  const tags = [...s.matchAll(/<(\w+)>/g)].map((m) => `<${m[1]}>`);
  return [...new Set([...placeholders, ...tags])].sort();
}

const koFlat = flatten(ko);
const koKeys = Object.keys(koFlat).sort();

describe("i18n 메시지 일관성", () => {
  it("routing.locales의 모든 언어 파일이 존재한다", () => {
    for (const loc of routing.locales) {
      expect(MESSAGES[loc], `messages/${loc}.json 누락`).toBeDefined();
    }
  });

  for (const loc of routing.locales) {
    if (loc === "ko") continue;
    const flat = flatten(MESSAGES[loc]);

    it(`${loc}: ko와 동일한 키 집합`, () => {
      const keys = Object.keys(flat).sort();
      const missing = koKeys.filter((k) => !(k in flat));
      const extra = keys.filter((k) => !(k in koFlat));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it(`${loc}: 키마다 ko와 동일한 플레이스홀더·태그 토큰`, () => {
      const mismatches: string[] = [];
      for (const key of koKeys) {
        if (!(key in flat)) continue;
        const a = tokens(koFlat[key]).join(",");
        const b = tokens(flat[key]).join(",");
        if (a !== b) mismatches.push(`${key}: ko[${a}] ≠ ${loc}[${b}]`);
      }
      expect(mismatches).toEqual([]);
    });

    // 번역 누락은 키 집합·토큰 검사를 통과한다(ko 문장을 그대로 복사해 넣으면
    // 키도 플레이스홀더도 맞다). 비-ko 로케일에 한글이 남아 있는지가 그것을
    // 잡는 유일한 축이고, `docs/SPEC.md` §2 "영어 UI 완결성"의 측정 수단이다.
    it(`${loc}: 한글 잔존 없음(자국어 표기 예외만 허용)`, () => {
      const leaked = Object.entries(flat)
        .filter(([key, value]) => !HANGUL_ALLOWED.has(key) && /[가-힣]/.test(value))
        .map(([key, value]) => `${key} = ${value}`);
      expect(leaked).toEqual([]);
    });
  }
});

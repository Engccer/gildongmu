import { describe, it, expect } from "vitest";
import { routing } from "@/i18n/routing";
import ko from "../../../messages/ko.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import itMessages from "../../../messages/it.json";

/**
 * 모든 로케일 메시지가 ko(기준)와 (1) 동일한 키 집합 (2) 키마다 동일한 ICU
 * 플레이스홀더·t.rich 태그 토큰을 갖는지 강제한다. 새 언어 추가나 키 수정 시
 * 누락·플레이스홀더 변형으로 인한 런타임 에러를 머지 전에 잡는 게이트다.
 */
const MESSAGES: Record<string, unknown> = { ko, en, es, fr, it: itMessages };

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

/** ICU 플레이스홀더 {xxx}와 빈 태그 <xxx>의 이름 집합(정렬). */
function tokens(s: string): string[] {
  const placeholders = [...s.matchAll(/\{(\w+)\}/g)].map((m) => `{${m[1]}}`);
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
  }
});

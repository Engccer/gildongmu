import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// "간략 안내"는 상세 안내가 구현 가능한지조차 모르던 시기의 탐색 산물이고, 그 탐색은
// 도보 상세 안내가 출시되며 끝났다(위원장 전제 정정 2026-08-16, 백로그 E16).
// 이 가드는 그 명칭이 사용자 노출 문자열로 다시 들어오는 것을 막는다.
//
// ⚠ 로케일 파일을 정적 import 하지 않고 디렉터리를 훑는다 — import 목록 방식은
// 새 로케일이 추가될 때 추가를 잊으면 그 파일만 조용히 비검사로 남는다.
const ROOTS = ["messages", path.join("ios", "i18n", "ios-extra")];

// "간략 안내"만 지우면 짝인 "상세 안내"가 홀로 남아 무엇과 대비되는지 알 수 없는
// 말이 된다 — 지우는 대상은 낱말이 아니라 대비 구조다.
// ⚠ 낱말이 아니라 구(句)로 검사한다: `상세`·`detail` 단독은 장소 상세 등 정당한
// 용례가 있어 오탐이 난다.
const FORBIDDEN = [
  "간략 안내",
  "상세 안내",
  "simple guidance",
  "detailed guidance",
  "guía simple",
  "guía detallada",
  "guidage simple",
  "guidage détaillé",
  "guida semplice",
  "guida dettagliata",
  "簡易案内",
  "詳細案内",
];

function* strings(value: unknown, trail: string[]): Generator<[string, string]> {
  if (typeof value === "string") {
    yield [trail.join("."), value];
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) yield* strings(v, [...trail, k]);
  }
}

const FILES = ROOTS.flatMap((root) =>
  readdirSync(root)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(root, f)),
);

describe("안내 모드 명칭 재유입 가드", () => {
  // 스캔이 0개 파일을 훑고도 통과하는 것이 이 계열 가드의 전형적 실패다.
  it("검사 대상이 6개 로케일 이상이다", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(FILES)("%s에 안내 모드 명칭이 없다", (file) => {
    const hits: string[] = [];
    for (const [key, value] of strings(JSON.parse(readFileSync(file, "utf8")), [])) {
      const lower = value.toLowerCase();
      for (const phrase of FORBIDDEN) {
        if (lower.includes(phrase.toLowerCase())) hits.push(`${key} = ${value}`);
      }
    }
    expect(hits).toEqual([]);
  });
});

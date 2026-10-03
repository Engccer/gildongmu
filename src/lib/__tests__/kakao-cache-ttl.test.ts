import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 카카오 응답 보관 시간 상한(2026-10-03 위원장 판정, BACKLOG §9 "카카오 응답 캐시 약관 질의"):
 * 캐시는 두되 장소 검색과 같은 300초를 넘기지 않는다. 카카오 엔드포인트를 부르는 provider
 * 파일의 `revalidate` 숫자 리터럴을 전수로 본다(실시간 안내 경로의 `no-store`는 대상 밖).
 */
const MAX_SECONDS = 300;
const DIR = join(process.cwd(), "src/lib/providers");

const kakaoProviders = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ file: f, src: readFileSync(join(DIR, f), "utf8") }))
  .filter(({ src }) => /dapi\.kakao\.com|kakaomobility\.com/.test(src));

describe("카카오 응답 캐시 보관 시간", () => {
  it("카카오를 부르는 provider를 찾는다(가드가 빈 집합으로 통과하지 않게)", () => {
    const names = kakaoProviders.map((p) => p.file);
    expect(names).toEqual(expect.arrayContaining(["kakao-address.ts", "kakao-walk.ts", "kakao-local.ts"]));
  });

  it.each(kakaoProviders.map((p) => [p.file, p.src] as const))(
    `%s의 revalidate는 ${MAX_SECONDS}초 이하다`,
    (_file, src) => {
      const values = [...src.matchAll(/revalidate:\s*([\d_]+)/g)].map((m) => Number(m[1].replace(/_/g, "")));
      for (const v of values) expect(v).toBeLessThanOrEqual(MAX_SECONDS);
    },
  );
});

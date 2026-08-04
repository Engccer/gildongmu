import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 서울 열린데이터 호스트를 부르는 provider는 **`res.json()`을 직접 부르지 않는다**는 정적 가드.
 *
 * 막는 결함: 인증키가 무효하면 `/json/` 경로여도 HTTP 200 + XML 본문이 오고,
 * `res.json()`은 그걸 `Unexpected token '<'`라는 원인 없는 SyntaxError로 만든다.
 * 키를 여러 서비스가 공유하므로 키가 죽으면 **동시에** 같은 방식으로 오진된다.
 *
 * 이 가드가 없으면 소비자가 하나 늘 때마다 사람이 기억해야 한다. 실제로
 * D2를 따릉이·문화행사만 보고 고쳤다가 같은 키·같은 호스트를 쓰는 네 번째
 * 소비자(`seoul-elevator`)를 빠뜨렸고, 리뷰가 그것을 잡았다.
 */

const PROVIDERS = join(process.cwd(), "src/lib/providers");
/**
 * `//`까지 포함해 정확히 맞춘다 — 실시간 지하철은 `swopenapi.seoul.go.kr`라는
 * **다른 호스트에 다른 키**(`SEOUL_SUBWAY_REALTIME_KEY`)를 쓰고 봉투도 다르며,
 * 그 호스트가 무효 키에 XML을 준다는 실측이 없다. 느슨한 substring은 그것까지
 * 끌어와 근거 없는 계약을 강요한다.
 */
const HOST = "//openapi.seoul.go.kr";

/**
 * 주석은 판정에서 뺀다 — 금지 대상을 설명하는 주석이 스스로 위반으로 잡힌다.
 * `https://` 문자열의 `//` 뒤가 주석으로 잘려 검사 대상이 자기 소멸하지 않도록
 * lookbehind 사용(dodo 역이식 2026-08-05).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

function seoulOpenProviders(): { name: string; code: string }[] {
  return readdirSync(PROVIDERS)
    .filter((f) => f.endsWith(".ts") && f !== "seoul-open-json.ts")
    .map((name) => ({ name, src: readFileSync(join(PROVIDERS, name), "utf8") }))
    .filter(({ src }) => src.includes(HOST))
    .map(({ name, src }) => ({ name, code: stripComments(src) }));
}

describe("서울 열린데이터 provider의 JSON 읽기 (정적 가드)", () => {
  it("대상 provider가 실제로 존재한다 (가드가 빈 집합을 통과하지 않는다)", () => {
    expect(seoulOpenProviders().length).toBeGreaterThan(2);
  });

  it(".json() 직접 호출이 없다 (readSeoulOpenJson 경유)", () => {
    // 수신자 변수명(res·response·r 등)과 무관하게 매치한다 — `\bres\.json`으로
    // 좁히면 변수명 한 번 바꾸는 것으로 가드가 뚫린다(dodo 3차 이식 중 검출).
    // `readSeoulOpenJson(`은 `.json(`이 아니라 오검출되지 않고, JSON.parse도 무관.
    const offenders = seoulOpenProviders()
      .filter(({ code }) => /\.\s*json\s*\(/.test(code))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});

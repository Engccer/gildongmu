import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * data.go.kr 호스트는 **평문 http로 부르지 않는다**는 정적 가드.
 *
 * 막는 결함: `http://apis.data.go.kr`는 TCP 연결까지는 되고 **응답이 오지 않는다**
 * (read ETIMEDOUT hang). 같은 요청이 https로는 0.07초에 돌아온다(실측 2026-08-04).
 * 끊기는 게 아니라 매달리므로 증상이 "실패"가 아니라 "느림"으로 나타나고,
 * `revalidate` 캐시도 영영 채워지지 않아 매 요청이 같은 시간을 다시 쓴다.
 *
 * 이 가드가 없으면 소비자가 하나 늘 때마다 사람이 기억해야 한다. 실제로 B2에서
 * `tago-bus`만 https로 고치고 같은 호스트를 쓰는 세 곳(`tago-subway`·
 * `bus-service-hours`·`holiday`)을 빠뜨렸고, 그 탓에 대중교통 길찾기가
 * 프로덕션에서 71초 걸려 앱 타임아웃으로 실패했다.
 *
 * ⚠ 스코프는 data.go.kr 호스트뿐이다. 서울 TOPIS(`ws.bus.go.kr`)와 실시간
 * 지하철(`swopenapi.seoul.go.kr`)은 http에서 정상 응답하며(TOPIS 0.02초 실측),
 * https 지원 근거가 없어 끌어오면 근거 없는 계약을 강요하게 된다.
 */

const PROVIDERS = join(process.cwd(), "src/lib/providers");
const HOST = "apis.data.go.kr";
const PLAINTEXT = `http://${HOST}`;

/**
 * 주석은 판정에서 뺀다 (금지 대상을 설명하는 주석이 스스로 위반으로 잡힌다).
 *
 * ⚠ 라인 주석 제거에서 **`:` 바로 뒤의 `//`는 살린다**. 안 그러면 검사 대상인
 * `"http://apis.data.go.kr/..."`가 `"http:`로 잘려 스스로 사라지고, 가드가
 * 위반을 통과시킨다(이 테스트를 처음 썼을 때 실제로 그렇게 green이 나왔다).
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

function dataGoKrProviders(): { name: string; code: string }[] {
  return readdirSync(PROVIDERS)
    .filter((f) => f.endsWith(".ts"))
    .map((name) => ({ name, src: readFileSync(join(PROVIDERS, name), "utf8") }))
    .filter(({ src }) => src.includes(HOST))
    .map(({ name, src }) => ({ name, code: stripComments(src) }));
}

describe("data.go.kr 호출 프로토콜 (정적 가드)", () => {
  it("대상 provider가 실제로 존재한다 (가드가 빈 집합을 통과하지 않는다)", () => {
    expect(dataGoKrProviders().length).toBeGreaterThan(0);
  });

  it.each(dataGoKrProviders())("$name 은 평문 http로 부르지 않는다", ({ code }) => {
    expect(code).not.toContain(PLAINTEXT);
  });
});

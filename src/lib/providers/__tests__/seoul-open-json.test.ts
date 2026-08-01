import { describe, it, expect } from "vitest";
import { readSeoulOpenJson } from "../seoul-open-json";

/**
 * 서울 열린데이터 공용 JSON 리더 계약.
 *
 * 이 모듈이 막는 것은 **하나뿐이다**: 무효 키가 `/json/` 경로에서도 HTTP 200 +
 * XML 본문으로 오는 탓에 `res.json()`이 원인 없는 SyntaxError로 죽는 것.
 * 봉투 정책(정상 코드가 무엇인가)은 서비스마다 달라 provider에 남는다.
 */
describe("readSeoulOpenJson", () => {
  it("무효 키의 XML 본문은 코드와 함께 인증키를 지목한다", async () => {
    const xml =
      "<RESULT><CODE>INFO-100</CODE><MESSAGE><![CDATA[인증키가 유효하지 않습니다.]]></MESSAGE></RESULT>";
    await expect(readSeoulOpenJson(new Response(xml), "citydata_ppltn")).rejects.toThrow(
      /INFO-100.*인증키/,
    );
  });

  it("코드를 못 읽는 비-JSON도 인증키를 먼저 의심하라고 말한다", async () => {
    await expect(readSeoulOpenJson(new Response("<html>502</html>"), "x")).rejects.toThrow(
      /인증키/,
    );
  });

  it("정상 JSON은 선행 공백이 있어도 그대로 파싱한다", async () => {
    expect(await readSeoulOpenJson(new Response('  {"a":1}'), "x")).toEqual({ a: 1 });
    expect(await readSeoulOpenJson(new Response("[1,2]"), "x")).toEqual([1, 2]);
  });

  it("라벨을 메시지에 남긴다 (어느 서비스가 죽었는지 로그로 갈린다)", async () => {
    await expect(readSeoulOpenJson(new Response("<x/>"), "bikeList")).rejects.toThrow(/bikeList/);
  });
});

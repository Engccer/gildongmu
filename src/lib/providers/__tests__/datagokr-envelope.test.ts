import { describe, it, expect, vi, afterEach } from "vitest";
import {
  readItems,
  readResultCode,
  readResultMsg,
  readTotalCount,
  fetchDataGoKrJson,
} from "../datagokr-envelope";

/** 표준 envelope 한 겹 감싸기 — 각 케이스가 items 모양에만 집중하게 한다. */
function body(items: unknown): unknown {
  return { response: { header: { resultCode: "00" }, body: { items } } };
}

describe("readItems — 모양 5종 흡수", () => {
  it("items 부재·null·비-envelope는 빈 배열", () => {
    expect(readItems(null)).toEqual([]);
    expect(readItems(undefined)).toEqual([]);
    expect(readItems({})).toEqual([]);
    expect(readItems({ response: {} })).toEqual([]);
    expect(readItems(body(null))).toEqual([]);
  });

  it("items가 문자열이면 빈 결과(data.go.kr 빈 결과 표기 items:'')", () => {
    expect(readItems(body(""))).toEqual([]);
    expect(readItems(body("no data"))).toEqual([]);
  });

  it("items 자체가 배열이면 그대로 읽는다(에어코리아 B552584 실측)", () => {
    expect(readItems(body([{ a: 1 }, { a: 2 }]))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("items.item 배열은 표준 경로", () => {
    expect(readItems(body({ item: [{ a: 1 }] }))).toEqual([{ a: 1 }]);
  });

  it("items.item 단일 객체는 1건 응답 — 배열로 감싼다", () => {
    expect(readItems(body({ item: { a: 1 } }))).toEqual([{ a: 1 }]);
  });

  it("레코드가 아닌 원소는 버린다(유령 항목 방지)", () => {
    // 감싸면 전 필드 undefined인 행이 되어 "이름 없는 항목"으로 낭독된다.
    expect(readItems(body({ item: "문자열" }))).toEqual([]);
    expect(readItems(body({ item: 7 }))).toEqual([]);
    expect(readItems(body({ item: [{ a: 1 }, "쓰레기", null] }))).toEqual([{ a: 1 }]);
    expect(readItems(body([{ a: 1 }, 3]))).toEqual([{ a: 1 }]);
  });

  it("빈 배열은 빈 배열(0건과 못 읽음을 뭉개지 않는 하류 계약의 입력)", () => {
    expect(readItems(body([]))).toEqual([]);
    expect(readItems(body({ item: [] }))).toEqual([]);
  });
});

describe("readResultCode · readResultMsg", () => {
  it("header에서 읽고 문자열로 정규화한다", () => {
    expect(readResultCode({ response: { header: { resultCode: "00" } } })).toBe("00");
    // 일부 서비스가 숫자로 준다 — 비교는 항상 문자열로 이뤄져야 한다.
    expect(readResultCode({ response: { header: { resultCode: 0 } } })).toBe("0");
    expect(readResultMsg({ response: { header: { resultMsg: "NORMAL" } } })).toBe("NORMAL");
  });

  it("부재는 null — 표준 envelope가 아니라는 뜻이지 정상이 아니다", () => {
    expect(readResultCode(null)).toBeNull();
    expect(readResultCode({})).toBeNull();
    expect(readResultCode({ response: { header: {} } })).toBeNull();
    expect(readResultMsg({})).toBeNull();
  });
});

describe("readTotalCount", () => {
  it("숫자·숫자문자열을 읽고 부재·비유한은 0", () => {
    expect(readTotalCount({ response: { body: { totalCount: 152 } } })).toBe(152);
    expect(readTotalCount({ response: { body: { totalCount: "152" } } })).toBe(152);
    expect(readTotalCount({ response: { body: {} } })).toBe(0);
    expect(readTotalCount({ response: { body: { totalCount: "삼" } } })).toBe(0);
    expect(readTotalCount(null)).toBe(0);
  });
});

/** text()를 갖춘 Response 스텁 — 공용 fetch는 json()이 아니라 text()로 받는다. */
function res(init: { ok: boolean; status: number; text: string }): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: async () => init.text,
  } as unknown as Response;
}

describe("fetchDataGoKrJson", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("정상 JSON은 파싱해 돌려준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => res({ ok: true, status: 200, text: '{"response":{"header":{"resultCode":"00"}}}' })),
    );
    await expect(fetchDataGoKrJson("https://x", "테스트")).resolves.toEqual({
      response: { header: { resultCode: "00" } },
    });
  });

  it("HTTP 실패는 상태코드와 본문 앞부분을 실어 throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res({ ok: false, status: 503, text: "서비스 점검" })));
    await expect(fetchDataGoKrJson("https://x", "테스트")).rejects.toThrow(/HTTP 503.*서비스 점검/);
  });

  it("HTTP 200 + XML 본문은 XML임을 밝혀 throw(키 만료·미신청의 실제 응답)", async () => {
    // res.json()이면 "Unexpected token '<'"라는 원인 없는 SyntaxError가 된다.
    const xml = '<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE KEY IS NOT REGISTERED ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>';
    vi.stubGlobal("fetch", vi.fn(async () => res({ ok: true, status: 200, text: xml })));
    await expect(fetchDataGoKrJson("https://x", "테스트")).rejects.toThrow(/비정상 응답\(XML\?\)/);
  });

  it("게이트웨이 인증 에러 envelope는 사유를 실어 throw", async () => {
    const json = JSON.stringify({
      OpenAPI_ServiceResponse: { cmmMsgHeader: { returnAuthMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } },
    });
    vi.stubGlobal("fetch", vi.fn(async () => res({ ok: true, status: 200, text: json })));
    await expect(fetchDataGoKrJson("https://x", "테스트")).rejects.toThrow(
      /서비스 에러\(인증\?\).*SERVICE_KEY_IS_NOT_REGISTERED_ERROR/,
    );
  });

  it("init을 fetch에 그대로 넘긴다(캐시 정책은 호출부 몫)", async () => {
    const spy = vi.fn(async () => res({ ok: true, status: 200, text: "{}" }));
    vi.stubGlobal("fetch", spy);
    await fetchDataGoKrJson("https://x", "테스트", { cache: "no-store" });
    expect(spy).toHaveBeenCalledWith("https://x", { cache: "no-store" });
  });
});

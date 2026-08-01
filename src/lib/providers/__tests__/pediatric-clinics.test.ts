import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/env", () => ({ env: { DATA_GO_KR_API_KEY: "test-key" } }));

const { fetchPediatricClinicsBySido } = await import(
  "@/lib/providers/pediatric-clinics"
);

/** 응급의료정보 envelope 한 페이지. rows는 dutyName만 다른 최소 항목. */
function page(totalCount: number, names: string[]) {
  return {
    response: {
      header: { resultCode: "00" },
      body: {
        totalCount,
        items: {
          item: names.map((name, i) => ({
            hpid: `H${name}${i}`,
            dutyName: name,
            dutyAddr: "서울특별시 강동구 성내로6길 15",
            dutyTel1: "02-000-0000",
            dutyDivNam: "의원",
            dutyEmclsName: "응급의료기관 이외",
            wgs84Lat: 37.53,
            wgs84Lon: 127.12,
            dutyTime1s: "0900",
            dutyTime1c: "1800",
          })),
        },
      },
    },
  };
}

function stubPages(pages: object[]) {
  const fetchMock = vi.fn(async (url: string) => {
    const pageNo = Number(new URL(url).searchParams.get("pageNo") ?? "1");
    return {
      ok: true,
      json: async () => pages[pageNo - 1],
      text: async () => JSON.stringify(pages[pageNo - 1]),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchPediatricClinicsBySido", () => {
  it("한 페이지로 끝나면 한 번만 호출한다", async () => {
    const fetchMock = stubPages([page(2, ["가소아과", "나소아과"])]);
    const clinics = await fetchPediatricClinicsBySido("서울특별시");

    expect(clinics.map((c) => c.name)).toEqual(["가소아과", "나소아과"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 시도 전량이 넘어와야 반경 필터가 정직하다 — 1페이지만 쓰면 조용한 절단이 된다.
  it("totalCount가 페이지를 넘으면 나머지 페이지를 마저 받아 합친다", async () => {
    const names = Array.from({ length: 1000 }, (_, i) => `가${i}`);
    const fetchMock = stubPages([page(1500, names), page(1500, ["나소아과"])]);
    const clinics = await fetchPediatricClinicsBySido("서울특별시");

    expect(clinics).toHaveLength(1001);
    expect(clinics.at(-1)?.name).toBe("나소아과");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 지정 명부(달빛)와 섞일 때 UI가 품질 보증 유무를 밝힐 수 있어야 한다.
  it("보완 소스는 designated=false로 표시한다", async () => {
    stubPages([page(1, ["가소아과"])]);
    const clinics = await fetchPediatricClinicsBySido("서울특별시");
    expect(clinics[0].designated).toBe(false);
  });

  // 상한을 넘으면 계약이 바뀐 것 — 부분집합을 전량인 척 내보내지 않는다.
  it("페이지 수가 상한을 넘으면 throw", async () => {
    stubPages([page(999_999, ["가소아과"])]);
    await expect(fetchPediatricClinicsBySido("서울특별시")).rejects.toThrow(
      /상한/,
    );
  });

  it("resultCode가 00이 아니면 throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ response: { header: { resultCode: "03" }, body: {} } }),
        text: async () => JSON.stringify(({ response: { header: { resultCode: "03" }, body: {} } })),
      })) as unknown as typeof fetch,
    );
    await expect(fetchPediatricClinicsBySido("서울특별시")).rejects.toThrow(
      /resultCode/,
    );
  });

  // 키·시도가 없으면 조회 자체가 성립하지 않는다(게이트 이중 방어).
  it("시도가 빈 문자열이면 호출 없이 빈 배열", async () => {
    const fetchMock = stubPages([page(1, ["가소아과"])]);
    await expect(fetchPediatricClinicsBySido("")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

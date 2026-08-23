import { describe, expect, it } from "vitest";
import { buildSeed, readPage } from "../../../scripts/build-crosswalk-seed.mjs";
import seed from "../data/crosswalks.json";

/**
 * 전국횡단보도표준데이터(15028201) seed 빌드 가드(spec 2026-08-23-crosswalk-lanes-length-design.md §2).
 * 봉투는 `response` 래퍼 없는 `{header, body}` 최상위라 공용 readItems 밖이고,
 * 빈 값이 공백 한 칸이라 trim이 빠지면 채움 판정이 거짓이 된다.
 */

type Row = Record<string, string>;

function row(over: Partial<Row> = {}): Row {
  return {
    ctprvnNm: "서울특별시",
    signguNm: "동작구",
    latitude: "37.50528157",
    longitude: "126.9266153",
    cartrkCo: "2",
    et: "6.2",
    greenSgngnrTime: " ",
    ...over,
  };
}

/** 가드(총건수·시도 수)를 통과하는 최소 바탕. */
function validRows(): Row[] {
  const sidos = [
    "서울특별시", "경기도", "강원특별자치도", "충청북도", "충청남도", "전라남도", "경상북도",
    "경상남도", "부산광역시", "대구광역시", "인천광역시", "광주광역시", "대전광역시", "울산광역시",
    "제주특별자치도",
  ];
  const rows: Row[] = [];
  for (let i = 0; i < 50_100; i++) {
    rows.push(
      row({
        ctprvnNm: sidos[i % sidos.length],
        latitude: String(35 + (i % 1000) / 1000),
        longitude: String(127 + (i % 777) / 1000),
        cartrkCo: String(1 + (i % 6)),
        et: String(5 + (i % 20)),
      }),
    );
  }
  return rows;
}

describe("readPage — 봉투", () => {
  it("정상 페이지는 item 배열을 준다", () => {
    const r = readPage({
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: { items: { item: [row()] }, totalCount: 1 },
    });
    expect(r).toEqual({ items: [row()], totalCount: 1 });
  });

  it("범위 밖 페이지(03 NODATA_ERROR, body null)는 끝 신호(빈 배열)", () => {
    const r = readPage({ header: { resultCode: "03", resultMsg: "NODATA_ERROR" }, body: null });
    expect(r).toEqual({ items: [], totalCount: 0 });
  });

  it("그 외 resultCode는 throw(키 만료·게이트웨이 오류를 빈 seed로 위장하지 않는다)", () => {
    expect(() =>
      readPage({ header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR." }, body: null }),
    ).toThrow(/30/);
  });

  it("XML 본문(문자열)은 throw", () => {
    expect(() => readPage("<OpenAPI_ServiceResponse>…" as unknown as object)).toThrow();
  });
});

describe("buildSeed — 투영·가드", () => {
  const meta = { now: "2026-08-23T00:00:00.000Z" };

  it("[lat, lng, 차로, 연장] 4튜플로 투영하고 공백 값은 trim 뒤 수치화한다", () => {
    const rows = validRows();
    rows[0] = row({ latitude: " 37.50528157 ", longitude: "126.9266153 ", cartrkCo: " 4", et: "15.04 " });
    const s = buildSeed(rows, meta);
    expect(s.crosswalks).toContainEqual([37.50528, 126.92662, 4, 15]);
  });

  it("연장 1~60m 밖(오기)은 탈락하고 counts에 남긴다", () => {
    const rows = validRows();
    rows[0] = row({ et: "302" });
    rows[1] = row({ et: "0.3", latitude: "37.1" });
    const s = buildSeed(rows, meta);
    expect(s.meta.counts.lengthOutOfRange).toBe(2);
    expect(s.crosswalks.some((c) => c[3] === 302 || c[3] === 0.3)).toBe(false);
  });

  it("완전 중복 행은 1건으로 — 같은 좌표의 값 다른 행은 둘 다 남는다(교차로 겹침은 런타임 판정 몫)", () => {
    const rows = validRows();
    rows.push(row({ latitude: "37.1", longitude: "127.1", cartrkCo: "2", et: "6.2" }));
    rows.push(row({ latitude: "37.1", longitude: "127.1", cartrkCo: "2", et: "6.2" }));
    rows.push(row({ latitude: "37.1", longitude: "127.1", cartrkCo: "1", et: "3.2" }));
    const s = buildSeed(rows, meta);
    const at = s.crosswalks.filter((c) => c[0] === 37.1 && c[1] === 127.1);
    expect(at).toHaveLength(2);
    expect(s.meta.counts.duplicates).toBe(1);
  });

  it("총건수 < 50,000이면 throw", () => {
    expect(() => buildSeed(validRows().slice(0, 100), meta)).toThrow(/총건수/);
  });

  it("한국 상자 밖 좌표가 하나라도 있으면 throw(좌표계 회귀 의심)", () => {
    const rows = validRows();
    rows[0] = row({ latitude: "3.75", longitude: "126.9" });
    expect(() => buildSeed(rows, meta)).toThrow(/상자/);
  });

  it("차로·연장 파싱률 < 99%면 throw(채움률 100% 전제가 깨진 것)", () => {
    const rows = validRows();
    for (let i = 0; i < 600; i++) rows[i] = row({ cartrkCo: " " });
    expect(() => buildSeed(rows, meta)).toThrow(/파싱률/);
  });

  it("시도 수 < 15면 throw(전국 전제)", () => {
    const rows = validRows().map((r) => ({ ...r, ctprvnNm: "경기도" }));
    expect(() => buildSeed(rows, meta)).toThrow(/시도/);
  });

  it("seed는 위도→경도 정렬이다(프리필터 결정성)", () => {
    const s = buildSeed(validRows(), meta);
    for (let i = 1; i < s.crosswalks.length; i++) {
      const a = s.crosswalks[i - 1], b = s.crosswalks[i];
      expect(a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])).toBe(true);
    }
  });
});

describe("번들된 seed", () => {
  const s = seed as { meta: { counts: { kept: number } }; crosswalks: number[][] };
  it("5만 건 이상이고 튜플 형태가 계약과 같다", () => {
    expect(s.crosswalks.length).toBeGreaterThan(50_000);
    expect(s.crosswalks.length).toBe(s.meta.counts.kept);
    for (const c of s.crosswalks.slice(0, 200)) {
      expect(c).toHaveLength(4);
      expect(c[2]).toBeGreaterThanOrEqual(1);
      expect(c[3]).toBeGreaterThanOrEqual(1);
      expect(c[3]).toBeLessThanOrEqual(60);
    }
  });
  it("서울 동작구 표본(여의대방로36길 2차로 6.2m)이 들어 있다", () => {
    expect(s.crosswalks).toContainEqual([37.50528, 126.92662, 2, 6.2]);
  });
});

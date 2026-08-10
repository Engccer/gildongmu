import { describe, it, expect } from "vitest";
import { rewriteCarGuidance, rewriteCarBriefing } from "../car-guidance";
import type { CarRouteBriefing } from "../types";
import corpus from "./fixtures/tmap-car-corpus.json";

/**
 * 자동차 안내문 재작성 계약. fixture는 전부 Tmap 실호출 원문이다(전국 12경로
 * 212문장 조사, 2026-08-10) — 손으로 지어낸 문장으로는 어휘 분포를 대표하지
 * 못한다(도보 364단계 조사와 동형).
 *
 * Tmap 문형은 하나뿐이다: `{지점}에서 {방면}으로 {행동} 후 {도로}를 따라 {거리} 이동`.
 * `{행동}` 자리에 회전 유형별 어휘가 가공 없이 들어가는데, 동작성 명사(우회전·
 * 좌회전·U턴)는 「후」와 자연스럽지만 상태·위치 명사(오른쪽 방향·터널·고가도로옆)는
 * 결합이 깨진다 — 실사용 리포트 "오른쪽 방향 후"(2026-08-10)가 그 사례이고,
 * 코퍼스의 53%(112/212)가 같은 계열이었다.
 */
describe("rewriteCarGuidance", () => {
  describe("방향 분기(117/118) — 회전이 아니라 갈래 선택이다", () => {
    it("실사용 리포트 문장: 오른쪽 방향 후 → 오른쪽 길로 들어선 뒤", () => {
      // 코퍼스 실측: "오른쪽 방향"은 48%가 같은 도로로 이어진다(올림픽대로→올림픽대로).
      // "우회전"으로 바꾸면 자동차전용도로 위에서 90도 회전 지시가 된다 — 금지.
      expect(
        rewriteCarGuidance(
          "강변북로(천호대교) 방면으로 오른쪽 방향 후 강변북로를 따라 281m 이동",
        ),
      ).toBe(
        "강변북로(천호대교) 방면으로 오른쪽 길로 들어선 뒤 강변북로를 따라 281m 이동",
      );
    });

    it("왼쪽 방향, 방면 없음", () => {
      expect(
        rewriteCarGuidance("천호대교남단에서 왼쪽 방향 후 올림픽대로를 따라 10668m 이동"),
      ).toBe("천호대교남단에서 왼쪽 길로 들어선 뒤 올림픽대로를 따라 10668m 이동");
    });
  });

  describe("시설 통과(터널·졸음쉼터·지하차도·고가도로)", () => {
    it("지점명이 시설어로 끝나면 흡수한다 — 받침에 따라 을/를", () => {
      // "남산1호터널에서 터널을 지나"는 원문의 중복이 재작성으로 도드라지는 자리다.
      expect(
        rewriteCarGuidance("남산1호터널에서 터널 후 삼일대로를 따라 2928m 이동"),
      ).toBe("남산1호터널을 지나 삼일대로를 따라 2928m 이동");
      expect(
        rewriteCarGuidance("옥천졸음쉼터에서 졸음쉼터 후 경부 고속도로를 따라 46769m 이동"),
      ).toBe("옥천졸음쉼터를 지나 경부 고속도로를 따라 46769m 이동");
      expect(
        rewriteCarGuidance("양재천 지하차도에서 지하차도 후 일반도로를 따라 812m 이동"),
      ).toBe("양재천 지하차도를 지나 일반도로를 따라 812m 이동");
    });

    it("지점명이 시설어를 품지 않으면 흡수하지 않는다(고가차도 ≠ 고가도로)", () => {
      expect(
        rewriteCarGuidance(
          "한남2 고가차도에서 장충체육관 방면으로 고가도로 후 한남대로를 따라 881m 이동",
        ),
      ).toBe(
        "한남2 고가차도에서 장충체육관 방면으로 고가도로를 지나 한남대로를 따라 881m 이동",
      );
    });
  });

  describe("옆길(123/124) — 시설을 지나는 게 아니라 옆길을 고르는 지시", () => {
    it("고가도로옆·지하차도옆", () => {
      expect(
        rewriteCarGuidance(
          "한남2 고가차도에서 금호 사거리 방면으로 고가도로옆 후 한남대로를 따라 255m 이동",
        ),
      ).toBe(
        "한남2 고가차도에서 금호 사거리 방면으로 고가도로 옆길로 들어선 뒤 한남대로를 따라 255m 이동",
      );
      // 지점명 "남태령 지하차도"가 "지하차도"로 끝나지만 행동은 "지하차도옆"(들어선 뒤
      // 계열)이라 흡수 대상이 아니다 — 흡수는 "지나" 계열에만 성립한다.
      expect(
        rewriteCarGuidance(
          "남태령 지하차도에서 서울(사당),강남순환로 방면으로 지하차도옆 후 중앙로를 따라 243m 이동",
        ),
      ).toBe(
        "남태령 지하차도에서 서울(사당),강남순환로 방면으로 지하차도 옆길로 들어선 뒤 중앙로를 따라 243m 이동",
      );
    });
  });

  describe("고속도로 입구·출구(101/103/104/111/113/114)", () => {
    it("입구는 들어선 뒤, 출구는 나온 뒤", () => {
      expect(
        rewriteCarGuidance(
          "북로JC에서 청라 방면으로 오른쪽 고속도로 입구 후 인천국제공항 고속도로를 따라 37182m 이동",
        ),
      ).toBe(
        "북로JC에서 청라 방면으로 오른쪽 고속도로 입구로 들어선 뒤 인천국제공항 고속도로를 따라 37182m 이동",
      );
      expect(
        rewriteCarGuidance(
          "북대구IC에서 북대구 방면으로 오른쪽 고속도로 출구 후 경부 고속도로를 따라 1103m 이동",
        ),
      ).toBe(
        "북대구IC에서 북대구 방면으로 오른쪽 고속도로 출구로 나온 뒤 경부 고속도로를 따라 1103m 이동",
      );
      expect(
        rewriteCarGuidance("대전IC에서 전방 고속도로 입구 후 경부 고속도로를 따라 614m 이동"),
      ).toBe("대전IC에서 전방 고속도로 입구로 들어선 뒤 경부 고속도로를 따라 614m 이동");
    });

    it("미관측 왼쪽 변형도 일반 규칙이 받는다(합성 — Tmap 표에 좌우 대칭 코드 존재 전제)", () => {
      expect(
        rewriteCarGuidance(
          "어딘가JC에서 어딘가 방면으로 왼쪽 도시고속도로 출구 후 어딘가로를 따라 100m 이동",
        ),
      ).toBe(
        "어딘가JC에서 어딘가 방면으로 왼쪽 도시고속도로 출구로 나온 뒤 어딘가로를 따라 100m 이동",
      );
    });
  });

  describe("N시 방향 단독(138/142)", () => {
    it("진행한 뒤로 푼다", () => {
      expect(
        rewriteCarGuidance(
          "만덕 사거리에서 여수엑스포역,여수세계박람회장 방면으로 8시 방향 후 일반도로를 따라 53m 이동",
        ),
      ).toBe(
        "만덕 사거리에서 여수엑스포역,여수세계박람회장 방면으로 8시 방향으로 진행한 뒤 일반도로를 따라 53m 이동",
      );
    });
  });

  describe("건드리지 않는 문장(fail-safe)", () => {
    it("회전 계열(좌회전·우회전·U턴·N시 방향 회전)은 원문 그대로", () => {
      for (const raw of [
        "교차로에서 우회전 후 천호대로를 따라 2635m 이동",
        "교차로에서 좌회전 후 천호대로197길을 따라 52m 이동",
        "교차로에서 U턴 후 상무대로를 따라 2227m 이동",
        "한남역에서 마포대교 방면으로 2시 방향 우회전 후 서빙고로를 따라 276m 이동",
        "둔촌고교입구에서 생태공원 앞 교차로 방면으로 8시 방향 좌회전 후 천호대로를 따라 3431m 이동",
      ]) {
        expect(rewriteCarGuidance(raw)).toBe(raw);
      }
    });

    it("출발·도착·미지 어휘는 원문 그대로", () => {
      for (const raw of [
        "일반도로를 따라 81m 이동", // 출발(200) — 「후」 없음
        "도착", // 도착(201)
        "교차로에서 로터리 후 어딘가길을 따라 100m 이동", // 미지 어휘 — 매핑 없음
        "염천교에서 서대문역 방면으로 좌회전", // 카카오 폴백 문형 — 꼬리 없음
      ]) {
        expect(rewriteCarGuidance(raw)).toBe(raw);
      }
    });
  });

  describe("전 코퍼스 불변식(212문장)", () => {
    const rows = corpus as Array<{ turnType: number | null; description: string }>;
    const rewritten = rows.map((r) => ({ ...r, out: rewriteCarGuidance(r.description) }));

    it("재작성 수는 정확히 112 — 어긋나면 규칙이나 fixture가 바뀐 것", () => {
      expect(rewritten.filter((r) => r.out !== r.description)).toHaveLength(112);
    });

    it("재작성 후 「후」는 회전 계열 뒤에만 남는다", () => {
      for (const r of rewritten) {
        if (!r.out.includes(" 후 ")) continue;
        expect(r.out).toMatch(/(?:좌회전|우회전|U턴) 후 /);
      }
    });

    it("어느 문장도 도로명·거리 꼬리를 잃지 않는다", () => {
      const TAIL = /(?:을|를) 따라 \d+(?:\.\d+)?k?m 이동$/;
      for (const r of rewritten) {
        const tail = TAIL.exec(r.description)?.[0];
        if (!tail) continue; // 도착 등 꼬리 없는 문장
        expect(r.out.endsWith(tail)).toBe(true);
      }
    });

    it("출발(200)·도착(201)은 byte-identical", () => {
      for (const r of rewritten) {
        if (r.turnType === 200 || r.turnType === 201) {
          expect(r.out).toBe(r.description);
        }
      }
    });
  });
});

describe("rewriteCarBriefing", () => {
  it("guidance만 바꾸고 기하·수치 필드는 보존한다", () => {
    const briefing: CarRouteBriefing = {
      distanceMeters: 18651,
      durationSeconds: 2713,
      taxiFare: 21300,
      tollFare: 0,
      guides: [
        {
          name: "",
          guidance: "천호대교남단에서 왼쪽 방향 후 올림픽대로를 따라 412m 이동",
          distanceMeters: 0,
          durationSeconds: 0,
          pathCoords: [{ lat: 37.53, lng: 127.08 }, { lat: 37.531, lng: 127.081 }],
          roadLinks: [{ name: "올림픽대로", distanceMeters: 412 }],
        },
      ],
      terminalCoord: { lat: 37.529, lng: 126.994 },
    };
    const out = rewriteCarBriefing(briefing);
    expect(out.guides[0].guidance).toBe(
      "천호대교남단에서 왼쪽 길로 들어선 뒤 올림픽대로를 따라 412m 이동",
    );
    expect(out.guides[0].pathCoords).toEqual(briefing.guides[0].pathCoords);
    expect(out.guides[0].roadLinks).toEqual(briefing.guides[0].roadLinks);
    expect(out.terminalCoord).toEqual(briefing.terminalCoord);
    expect(out.distanceMeters).toBe(18651);
    // 원본 불변(순수 함수)
    expect(briefing.guides[0].guidance).toContain("왼쪽 방향 후");
  });
});

import { describe, it, expect } from "vitest";
import {
  rewriteWalkBriefing,
  rewriteWalkGuidance,
  rewriteWalkGuidanceWithLive,
} from "../walk-guidance";

/**
 * 도보 안내문 재작성 계약. fixture는 전부 카카오 실호출 원문이다(경로 16개
 * 364단계 조사, 2026-08-07) — 손으로 지어낸 문장으로는 문형 분포를 대표하지
 * 못한다. 결과 틀은 `{어디서} {어느 쪽으로 돌아} {어디까지} {길}을 따라 {거리} 이동`.
 */
describe("rewriteWalkGuidance", () => {
  describe("괄호 도로명을 문장 안으로", () => {
    it("도로명을 거리 앞으로 옮기고 조사를 받침으로 정한다", () => {
      expect(rewriteWalkGuidance("길동사거리까지 128m 이동(천호대로)")).toBe(
        "길동사거리까지 천호대로를 따라 128m 이동",
      );
      // "길"은 받침이 있어 "을" — 조사를 고정하면 절반이 틀린다
      expect(rewriteWalkGuidance("오른쪽길로 173m 이동(경수대로1220번길)")).toBe(
        "오른쪽으로 돌아 경수대로1220번길을 따라 173m 이동",
      );
    });

    it("장소명 속 괄호는 도로명이 아니므로 건드리지 않는다", () => {
      // 실측 유일 예외. "…를 따라"를 붙였다면 "임시폐쇄를 따라"가 나갔다.
      expect(
        rewriteWalkGuidance("삼성역 2호선 7번출구(임시폐쇄)까지 횡단보도 이용", 30),
      ).toBe("삼성역 2호선 7번출구(임시폐쇄)까지 횡단보도를 건너세요, 30m");
    });

    it("괄호가 둘이면 문장 끝의 것만 도로명으로 본다", () => {
      expect(
        rewriteWalkGuidance("삼성역 2호선 7번출구(임시폐쇄) 앞에서 326m 이동(영동대로)"),
      ).toBe("삼성역 2호선 7번출구(임시폐쇄) 앞에서 영동대로를 따라 326m 이동");
    });

    it("조사를 정할 수 없는 도로명이면 원문을 보존한다", () => {
      const raw = "교차로까지 100m 이동(Gangnam-daero)";
      expect(rewriteWalkGuidance(raw)).toBe(raw);
    });
  });

  describe("방향을 행동 순서대로 앞에 둔다", () => {
    it("목적지가 있으면 방향이 목적지보다 앞에 온다", () => {
      expect(rewriteWalkGuidance("봉래면옥까지 왼쪽길로 30m 이동")).toBe(
        "왼쪽으로 돌아 봉래면옥까지 30m 이동",
      );
    });

    it("기점이 있으면 방향은 기점 뒤에 온다", () => {
      expect(
        rewriteWalkGuidance("봉래면옥 앞에서 왼쪽길로 37m 이동(천호대로197길)"),
      ).toBe("봉래면옥 앞에서 왼쪽으로 돌아 천호대로197길을 따라 37m 이동");
    });

    it("기점과 목적지가 모두 있으면 그 사이에 온다", () => {
      expect(
        rewriteWalkGuidance(
          "양재초교교차로에서 서초구청교차로까지 왼쪽길로 1.3km 이동(바우뫼로15길)",
        ),
      ).toBe(
        "양재초교교차로에서 왼쪽으로 돌아 서초구청교차로까지 바우뫼로15길을 따라 1.3km 이동",
      );
    });

    it("둘 다 없으면 방향이 문장 맨 앞에 온다", () => {
      expect(rewriteWalkGuidance("오른쪽길로 200m 이동")).toBe(
        "오른쪽으로 돌아 200m 이동",
      );
    });

    it("방향이 없는 문장은 어순을 바꾸지 않는다", () => {
      expect(
        rewriteWalkGuidance("한빛안경랜드 앞에서 길동사거리앞교차로까지 451m 이동(천호대로)"),
      ).toBe("한빛안경랜드 앞에서 길동사거리앞교차로까지 천호대로를 따라 451m 이동");
    });

    it("에서·까지가 아닌 앞부분도 흡수한다", () => {
      // 좁은 패턴이 놓쳐 도로명 괄호가 남았던 5건 계열(전수 검사로 검출)
      expect(rewriteWalkGuidance("길동역 1번 출구 진출 후 94m 이동(양재대로)")).toBe(
        "길동역 1번 출구 진출 후 양재대로를 따라 94m 이동",
      );
    });
  });

  describe("거리를 말하지 않던 단계", () => {
    it("횡단보도는 거리를 이동으로 빼고 시설을 뒤에 붙인다", () => {
      expect(rewriteWalkGuidance("길동사거리앞교차로에서 횡단보도 이용", 13)).toBe(
        "길동사거리앞교차로에서 횡단보도를 건너세요, 13m",
      );
    });

    it("복수 횡단보도만 개수를 말한다", () => {
      expect(
        rewriteWalkGuidance("둔촌고교입구교차로에서 한빛안경랜드까지 2개의 횡단보도 이용", 46),
      ).toBe("둔촌고교입구교차로에서 한빛안경랜드까지 횡단보도 2개를 건너세요, 46m");
      // 단수에 "1개"를 붙이면 원문에 없던 말이 된다
      expect(rewriteWalkGuidance("횡단보도 이용", 12)).toBe("횡단보도를 건너세요, 12m");
    });

    it("지하보도는 횡단보도와 같은 틀을 쓴다", () => {
      expect(rewriteWalkGuidance("여의도공원앞교차로에서 지하보도 이용", 356)).toBe(
        "여의도공원앞교차로에서 지하보도로 건너세요, 356m",
      );
    });

    it("교량은 '이동, 진입'이 순서가 뒤집혀 들려 도로명 틀을 쓴다", () => {
      expect(rewriteWalkGuidance("교량 진입", 260)).toBe("교량을 따라 260m 이동");
    });

    it("역사 내 이동은 거리만 동사 앞에 끼운다", () => {
      // 실측 최대 411m. 5분 넘는 구간이 거리 없이 한 문장으로 지나갔다.
      expect(
        rewriteWalkGuidance("서울역으로 진입하여 서울역 7번 출구까지 역사 내 이동", 411),
      ).toBe("서울역으로 진입하여 서울역 7번 출구까지 역사 내 411m 이동");
    });

    it("거리를 모르면 원문을 보존한다", () => {
      expect(rewriteWalkGuidance("횡단보도 이용")).toBe("횡단보도 이용");
    });

    it("횡단보도가 하나면 개수를 말하지 않는다", () => {
      // "1개"는 개수 정보가 아닌 데다, 병합 게이트를 잘못 열어 그 단계의
      // 음향신호기 주석을 지운다(codex 적대적 리뷰 검출).
      expect(rewriteWalkGuidance("1개의 횡단보도 이용", 12)).toBe("횡단보도를 건너세요, 12m");
    });

    it("1km 이상은 formatDistance 규칙(소수 km)을 따른다", () => {
      expect(rewriteWalkGuidance("교량 진입", 1250)).toBe("교량을 따라 1.25km 이동");
    });
  });

  describe("fail-safe", () => {
    it("규칙에 없는 문형은 원문 그대로 통과시킨다", () => {
      // Tmap 폴백 문장·withStepFree 안전 문장이 이 경로로 보존된다
      const notice = "계단 없는 경로를 확정하지 못했습니다. 안내 경로에 계단이 포함될 수 있습니다.";
      expect(rewriteWalkGuidance(notice, 0)).toBe(notice);
      expect(rewriteWalkGuidance("직진 후 광장 통과", 50)).toBe("직진 후 광장 통과");
    });

    it("이미 거리를 말하는 km 문장에 거리를 덧붙이지 않는다", () => {
      // 판정이 \d+\s*m 이었을 때 "1km"의 m을 못 잡아 중복 낭독 직전까지 갔다
      expect(rewriteWalkGuidance("지지대교차로에서 1km 이동(경수대로)", 1027)).toBe(
        "지지대교차로에서 경수대로를 따라 1km 이동",
      );
    });

    it("한글 단위로 거리를 말하는 문장에도 덧붙이지 않는다", () => {
      // 마지막 "…이동" 폴백은 미매칭 문장 **전부**를 대상으로 삼으므로, 표기만
      // 다르면 "100미터 100m 이동"으로 겹친다(codex 적대적 리뷰 검출).
      expect(rewriteWalkGuidance("엘리베이터로 100미터 이동", 100)).toBe(
        "엘리베이터로 100미터 이동",
      );
      expect(rewriteWalkGuidance("약 1.2킬로미터 이동", 1200)).toBe("약 1.2킬로미터 이동");
    });

    it("거리가 없는 미매칭 '…이동' 문장은 폴백이 계속 채운다", () => {
      // 위 가드가 폴백을 통째로 막으면 안 된다 — 어미가 "역사 내 이동"이 아닌
      // 실제 문장들이 이 경로로 거리를 얻는다(계단 회피 모드 실측).
      expect(rewriteWalkGuidance("엘레베이터를 이용하여 강동역으로 이동", 79)).toBe(
        "엘레베이터를 이용하여 강동역으로 79m 이동",
      );
    });

    it("Tmap 폴백 문장은 재작성 후에도 원문과 같다", () => {
      // 재작성은 provider 구분 없이 전량 적용되므로, Tmap 문형이 카카오용 규칙에
      // 걸려 변조되지 않음을 명시적으로 못 박는다(SK가 문구를 바꾸면 여기서 깨진다).
      for (const raw of [
        "158m 이동 후 우회전",
        "보행자도로를 따라 100m 이동",
        "횡단보도 후 좌회전",
        "우측 횡단보도 후 11m 이동",
      ]) {
        expect(rewriteWalkGuidance(raw, 158)).toBe(raw);
      }
    });
  });

  it("description 외 필드는 보존한다", () => {
    const out = rewriteWalkBriefing(
      {
        distanceMeters: 100,
        durationSeconds: 90,
        steps: [
          { description: "횡단보도 이용", distanceMeters: 13, pathCoords: [{ lat: 37.5, lng: 127.1 }] },
        ],
      },
      false,
    );
    expect(out.steps[0]).toEqual({
      description: "횡단보도를 건너세요, 13m",
      distanceMeters: 13,
      pathCoords: [{ lat: 37.5, lng: 127.1 }],
    });
  });
});

describe("rewriteWalkGuidanceWithLive — live 조각(spec 2026-08-11 §5)", () => {
  it("이동 문장에서 anchor(…에서)·target(…까지)을 뽑는다", () => {
    const r = rewriteWalkGuidanceWithLive(
      "천호역 4번 출구에서 파리바게뜨까지 왼쪽길로 58m 이동(명일로)",
    );
    expect(r.text).toBe(
      "천호역 4번 출구에서 왼쪽으로 돌아 파리바게뜨까지 명일로를 따라 58m 이동",
    );
    expect(r.live).toEqual({ target: "파리바게뜨", anchor: "천호역 4번 출구" });
  });

  it("anchor의 후행 '앞'은 벗긴다(예고 틀 '{anchor} 앞에서'와 중복 방지)", () => {
    const r = rewriteWalkGuidanceWithLive("메가 MGC커피 앞에서 횡단보도 이용", 21);
    expect(r.text).toBe("메가 MGC커피 앞에서 횡단보도를 건너세요, 21m");
    expect(r.live).toEqual({ anchor: "메가 MGC커피" });
  });

  it("…에서/…까지 절이 없으면 필드 부재(지어내지 않는다)", () => {
    const r = rewriteWalkGuidanceWithLive("길동역 1번 출구 진출 후 94m 이동(양재대로)");
    expect(r.live).toBeUndefined();
  });

  it("미매칭 폴백('역사 내 이동')은 조각 없음", () => {
    expect(rewriteWalkGuidanceWithLive("역사 내 이동", 411).live).toBeUndefined();
  });

  it("rewriteWalkGuidance 래퍼는 종전 문자열 계약 그대로", () => {
    expect(
      rewriteWalkGuidance("천호역 4번 출구에서 파리바게뜨까지 왼쪽길로 58m 이동(명일로)"),
    ).toBe("천호역 4번 출구에서 왼쪽으로 돌아 파리바게뜨까지 명일로를 따라 58m 이동");
  });
});

describe("rewriteWalkBriefing — live 부착은 옵트인", () => {
  const briefing = {
    distanceMeters: 58,
    durationSeconds: 60,
    steps: [
      {
        description: "천호역 4번 출구에서 파리바게뜨까지 왼쪽길로 58m 이동(명일로)",
        distanceMeters: 58,
      },
    ],
  };

  it("includeLive=true면 스텝에 live가 실린다", () => {
    expect(rewriteWalkBriefing(briefing, true).steps[0].live).toEqual({
      target: "파리바게뜨",
      anchor: "천호역 4번 출구",
    });
  });

  it("includeLive=false면 필드 자체 부재(기존 응답 byte-호환)", () => {
    expect("live" in rewriteWalkBriefing(briefing, false).steps[0]).toBe(false);
  });
});

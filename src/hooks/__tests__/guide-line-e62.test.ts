import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import ko from "../../../messages/ko.json";
import type { GuideRoute } from "@/lib/route-guide";
import { nextLine, rereadUnitText, walkImminentLine } from "../useRouteGuide";

/**
 * E62 낭독 조립(spec `2026-10-03-crosswalk-guidance-design.md` §5). 기대 문장은 문안 확정본 그대로다.
 */

type GuideT = Parameters<typeof nextLine>[4];
const t = createTranslator({ locale: "ko", messages: ko, namespace: "guide" }) as unknown as GuideT;

function route(descs: string[]): GuideRoute {
  return {
    polyline: { points: [], cum: [] },
    totalMeters: 0,
    steps: descs.map((description, index) => ({ index, description, startD: index * 50, endD: index * 50 + 50, isLong: true })),
  };
}

describe("임박 횡단 문장에 방향(문안 나 '바로 앞')", () => {
  it("그대로·뒤로·시계 방향·모름", () => {
    expect(walkImminentLine("crosswalk", 12, t)).toBe("잠시 후 진행 방향 그대로 횡단보도를 건너세요");
    expect(walkImminentLine("crosswalk", 9, t)).toBe("잠시 후 9시 방향으로 돌아 횡단보도를 건너세요");
    expect(walkImminentLine("crosswalk", 6, t)).toBe("잠시 후 뒤로 돌아 횡단보도를 건너세요");
    expect(walkImminentLine("crosswalk", undefined, t)).toBe("잠시 후 횡단보도를 건너세요");
    // 횡단이 아닌 행동은 방향 시와 무관하게 종전 문장
    expect(walkImminentLine("left", 9, t)).toBe("잠시 후 왼쪽으로 도세요");
  });
});

describe("되읽기는 들어선 스텝의 회전 문장을 뗀다(문안 확정본 '구간 안에서 다시 읽는 자리')", () => {
  const r = route(["왼쪽으로 도세요. 그 후 성내로를 따라 편의점까지 37m 이동", "카페 앞에서 오른쪽으로 도세요. 그 후 82m 이동"]);

  it("첫 index는 body, 뒤 스텝은 원문(아직 앞이라 회전을 지시한다)", () => {
    const live = [{ body: "성내로를 따라 편의점까지 37m 이동" }, { body: "82m 이동" }];
    expect(rereadUnitText(r, [0], live, t)).toBe("성내로를 따라 편의점까지 37m 이동");
    expect(rereadUnitText(r, [0, 1], live, t)).toBe(
      "다음 안내. 성내로를 따라 편의점까지 37m 이동. 카페 앞에서 오른쪽으로 도세요. 그 후 82m 이동",
    );
  });

  it("body가 없으면(판본 1 응답) 원문", () => {
    expect(rereadUnitText(r, [0], [{}, {}], t)).toBe("왼쪽으로 도세요. 그 후 성내로를 따라 편의점까지 37m 이동");
  });
});

describe("시작 문장은 할 일 먼저, 요약은 뒤(문안 라)", () => {
  it("detailStart", () => {
    expect(t("detailStart", { dest: "목적지", first: "천호대로를 따라 39m 이동", count: 14, distance: "1.4km" })).toBe(
      "목적지까지 도보 안내 시작. 천호대로를 따라 39m 이동. 안내 14개, 총 1.4km.",
    );
  });

  it("예고 머리말", () => {
    expect(t("announceAhead", { distance: "19m", step: "왼쪽으로 도세요. 그 후 성내로를 따라 편의점까지 37m 이동" })).toBe(
      "앞으로 약 19m 가다가 왼쪽으로 도세요. 그 후 성내로를 따라 편의점까지 37m 이동",
    );
  });
});

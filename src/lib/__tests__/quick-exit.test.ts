import { describe, expect, it } from "vitest";

import { doorPosition, findQuickExit, selectQuickExitDoors } from "../quick-exit";

const f = (stationName: string, lineName: string, previousStopName: string | null) =>
  findQuickExit({ stationName, lineName, previousStopName });

describe("방향 판정 — 직전역으로 배제하고 정확히 하나 남을 때만", () => {
  it("일반: 여의나루에서 온 여의도는 상행(다음 역 신길)", () => {
    // 하행 방면이 여의나루라 배제되고 상행만 남는다.
    expect(f("여의도", "수도권 5호선", "여의나루")?.elevator?.doors).toEqual(["6-4"]);
  });

  it("종점: 개화산에서 온 방화는 상행(방면이 자기 역명)", () => {
    expect(f("방화", "수도권 5호선", "개화산")?.stairs?.doors).toEqual(["4-2"]);
  });

  it("분기역은 null — 두 방면의 시설을 쌍으로 묶으면 어느 열차에서도 안 맞는다", () => {
    expect(f("강동", "수도권 5호선", "천호")).toBeNull();
  });

  it("단방향 수록 역의 정방향은 성공", () => {
    expect(f("한양대", "수도권 2호선", "뚝섬")?.elevator?.doors).toEqual(["3-3"]);
  });

  it("단방향 수록 역의 역방향은 null — 결측을 단방향으로 오인하면 반대 문을 낭독한다", () => {
    expect(f("한양대", "수도권 2호선", "왕십리")).toBeNull();
  });

  it("응암순환은 성공", () => {
    expect(f("연신내", "수도권 6호선", "독바위")?.elevator?.doors).toEqual(["6-2"]);
  });

  it("부역명은 정규화한다", () => {
    expect(f("강변(동서울터미널)", "수도권 2호선", "구의")?.stairs?.doors).toEqual(["8-3"]);
  });

  it("직전역이 없으면 null", () => {
    expect(f("여의도", "수도권 5호선", null)).toBeNull();
    expect(f("여의도", "수도권 5호선", "  ")).toBeNull();
    // ⚠ 양방향 역은 배제가 0건이라 저절로 null이 된다 — 가드가 실제로 필요한 곳은
    //   단방향 수록 역이다. 여기서 값이 나오면 "어디서 왔는지 모르는데 문을 안내"한 것이다.
    expect(f("한양대", "수도권 2호선", null)).toBeNull();
  });

  it("직전역이 어느 방면과도 안 맞으면 null(급행 통과·표기 불일치 안전판)", () => {
    // 두 방향 중 아무것도 배제되지 않으면 우리 방향을 모른다. 남은 첫 방향을 집으면
    // 절반의 확률로 반대편 승강장 끝을 안내한다.
    expect(f("여의도", "수도권 5호선", "서울역")).toBeNull();
  });

  it("방면 없는 방향은 배제될 수 없어 채택하지 않는다(응암 6호선 상행)", () => {
    // 새절에서 오면 하행이 배제되고 방면 없는 상행만 남지만, 방면을 모르면 그 방향이
    // 우리 방향이라는 근거가 없다 — 배제로 살아남은 것과 확인된 것은 다르다.
    expect(f("응암", "수도권 6호선", "새절")).toBeNull();
    // 구산에서 오면 아무것도 배제되지 않아 둘이 남는다.
    expect(f("응암", "수도권 6호선", "구산")).toBeNull();
  });

  it("수록 없는 역은 null", () => {
    expect(f("김포공항", "수도권 9호선", "공항시장")).toBeNull();
  });
});

describe("노선명 정규화", () => {
  it("수도권 접두를 벗긴다", () => {
    expect(f("여의도", "수도권 5호선", "여의나루")).not.toBeNull();
    expect(f("여의도", "5호선", "여의나루")).not.toBeNull();
  });

  it("서교공 밖 노선은 null", () => {
    expect(f("여의도", "수도권 9호선", "샛강")).toBeNull();
  });

  it("미지 표기는 추측하지 않고 null", () => {
    expect(f("여의도", "신분당선", "샛강")).toBeNull();
  });
});

describe("선형 위치 — (칸 차이, 문 차이) 사전순이 아니다", () => {
  it("칸 경계: 1-4와 2-1은 같은 칸 양끝보다 가깝다", () => {
    expect(doorPosition("1-4")).toBe(4);
    expect(doorPosition("2-1")).toBe(5);
    expect(doorPosition("2-4")).toBe(8);
    // 사전순 모델이면 |1-4 ↔ 2-1|(칸 1 차이)이 |2-1 ↔ 2-4|(칸 0 차이)보다 멀다고 본다.
    expect(Math.abs(doorPosition("1-4")! - doorPosition("2-1")!)).toBeLessThan(
      Math.abs(doorPosition("2-1")! - doorPosition("2-4")!),
    );
  });

  it("문 사이는 중간값을 앵커로 쓴다", () => {
    expect(doorPosition("3-2,3-3 사이")).toBe(10.5);
  });

  it("미지 형태는 null", () => {
    expect(doorPosition("NA-NA")).toBeNull();
    expect(doorPosition("6~4")).toBeNull();
  });
});

describe("시설 선택 — 쌍 최적화", () => {
  it("각자 최저가 아니라 선형 거리 최소 쌍(서울역 1호선 하행은 계단 4-2)", () => {
    const r = f("서울역", "수도권 1호선", "시청");
    expect(r?.elevator?.doors).toEqual(["4-4"]);
    // 각자 최저 문번호였다면 1-1이 나와 세 칸이 벌어진다.
    expect(r?.stairs?.doors).toEqual(["4-2"]);
  });

  it("엘리베이터가 복수면 쌍으로 함께 고른다(창동 4호선 상행)", () => {
    const r = f("창동", "수도권 4호선", "쌍문");
    expect(r?.elevator?.doors).toEqual(["2-4"]);
    expect(r?.stairs?.doors).toEqual(["3-4"]);
  });

  it("선형과 사전순이 갈리는 표본에서 선형을 따른다(상봉 7호선 하행)", () => {
    // 엘베 5-1(17)·6-2(22), 계단 3-4(12)·5-4(20). 선형 최소는 (6-2, 5-4)로 거리 2인데,
    // 사전순(칸×100+문)이면 칸이 다른 쌍이 통째로 밀려 (5-1, 5-4)가 뽑힌다.
    // 동률이 아닌 표본이라 이 케이스가 없으면 사전순 변이가 helper 테스트에만 걸린다.
    const r = f("상봉", "수도권 7호선", "중화");
    expect(r?.elevator?.doors).toEqual(["6-2"]);
    expect(r?.stairs?.doors).toEqual(["5-4"]);
  });

  it("동률은 엘리베이터 위치 → 계단 위치 오름차순으로 자른다", () => {
    // 여의도 상행: 엘베 6-4(24)에서 계단 5-4(20)·7-4(28)가 똑같이 4만큼 떨어져 있다.
    const r = f("여의도", "수도권 5호선", "여의나루");
    expect(r?.stairs?.doors).toEqual(["5-4"]);
  });

  it("계단만 있으면 계단만(선형 위치 최소)", () => {
    const r = f("응암", "수도권 6호선", "역촌");
    expect(r).toBeNull(); // 응암은 방면 사유로 null — 계단만 케이스는 아래 역으로 본다
    const only = f("한양대", "수도권 2호선", "뚝섬");
    expect(only?.stairs).toBeUndefined();
    expect(only?.elevator?.doors).toEqual(["3-3"]);
  });

  it("한쪽만 있으면 없는 쪽 키를 만들지 않는다(3-state: 부재 = 정보 없음)", () => {
    const r = f("연신내", "수도권 6호선", "독바위");
    expect(r).toEqual({ elevator: { kind: "door", doors: ["6-2"] } });
    expect("stairs" in r!).toBe(false);
  });

  it("동률 결과가 입력 순서에 흔들리지 않는다", () => {
    // 엘베 6-4(24)에서 5-4(20)·7-4(28)가 동거리다. 총정렬 tie-break가 없으면 "먼저 만난
    // 쪽"이 이겨, 다음 스냅숏이 행 순서만 바꿔도 안내가 반대편 문으로 뒤집힌다.
    // ⚠ seed는 문 번호를 문자열 정렬해 두므로 현재 데이터만으로는 이 변이가 관측되지 않는다.
    const forward = selectQuickExitDoors(["6-4"], ["5-4", "7-4"]);
    const reversed = selectQuickExitDoors(["6-4"], ["7-4", "5-4"]);
    expect(forward?.stairs?.doors).toEqual(["5-4"]);
    expect(reversed).toEqual(forward);
  });

  it("엘리베이터 쪽 동률도 순서에 흔들리지 않는다", () => {
    // 계단 5-1(17) 기준으로 4-1(13)·6-1(21)이 동거리다.
    const forward = selectQuickExitDoors(["4-1", "6-1"], ["5-1"]);
    const reversed = selectQuickExitDoors(["6-1", "4-1"], ["5-1"]);
    expect(forward?.elevator?.doors).toEqual(["4-1"]);
    expect(reversed).toEqual(forward);
  });
});

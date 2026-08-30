import { describe, expect, it } from "vitest";
import {
  brandCore,
  kstToday,
  matchGoogleCandidate,
  regionTokensFromAddress,
  roadKey,
  todayHours,
  type GoogleCandidate,
} from "../place-hours";

// 워터캐슬 하남미사점 실측 좌표(카카오 vs 구글 85m 이격, 도로명 주소 동일) — E24 대형 시설 사각지대
const WATER_CASTLE_KAKAO = { name: "워터캐슬 하남미사점", lat: 37.567111, lng: 127.19749, roadAddress: "경기 하남시 미사대로 520" };
const WATER_CASTLE_GOOGLE: GoogleCandidate = {
  id: "g1", name: "워터캐슬 하남미사점", lat: 37.566514, lng: 127.196883,
  formattedAddress: "대한민국 경기도 하남시 미사대로 520",
};

describe("matchGoogleCandidate", () => {
  it("B1: 이름 완전 일치 + 50m 이내", () => {
    const c: GoogleCandidate = { id: "a", name: "카페 그로브", lat: 37.5301, lng: 127.1235 };
    expect(matchGoogleCandidate({ name: "카페그로브", lat: 37.5302, lng: 127.1235 }, [c])?.id).toBe("a");
  });
  it("B1': 이름 일치인데 85m 떨어져도 도로명 주소 키가 같으면 매칭(워터캐슬)", () => {
    expect(matchGoogleCandidate(WATER_CASTLE_KAKAO, [WATER_CASTLE_GOOGLE])?.id).toBe("g1");
  });
  it("이름 일치·50m 초과·도로명 키 불일치는 기각", () => {
    const far = { ...WATER_CASTLE_GOOGLE, formattedAddress: "경기도 하남시 미사대로 521" };
    expect(matchGoogleCandidate(WATER_CASTLE_KAKAO, [far])).toBeNull();
  });
  it("B2: 브랜드 코어 일치 + 50m 이내(페리카나 풍납점 ↔ 페리카나치킨 풍납2점은 코어가 달라 기각, 지점 변형은 통과)", () => {
    const target = { name: "페리카나 풍납점", lat: 37.53, lng: 127.11, roadAddress: "서울 송파구 풍납동 123" };
    const variant: GoogleCandidate = { id: "v", name: "페리카나 풍납2점", lat: 37.53001, lng: 127.11 };
    expect(matchGoogleCandidate(target, [variant])?.id).toBe("v");
  });
  it("B3 기각: 좌표만 가까운 다른 이름은 매칭하지 않는다", () => {
    const neighbor: GoogleCandidate = { id: "n", name: "옆집 식당", lat: 37.5301, lng: 127.1235 };
    expect(matchGoogleCandidate({ name: "우리 식당", lat: 37.5301, lng: 127.1235 }, [neighbor])).toBeNull();
  });
  it("완전 일치가 브랜드 코어 일치보다 우선한다", () => {
    const core: GoogleCandidate = { id: "c", name: "만랩커피 천호점", lat: 37.5301, lng: 127.1235 };
    const exact: GoogleCandidate = { id: "e", name: "만랩커피 강동ECT점", lat: 37.5301, lng: 127.1235 };
    expect(matchGoogleCandidate({ name: "만랩커피 강동ECT점", lat: 37.5301, lng: 127.1235 }, [core, exact])?.id).toBe("e");
  });
});

describe("이름·주소 정규화", () => {
  it("regionTokensFromAddress는 주소의 행정구역 낱말만 뽑는다", () => {
    expect(regionTokensFromAddress("서울 강동구 천호동 12-3")).toEqual(["강동", "천호"]);
    expect(regionTokensFromAddress(undefined)).toEqual([]);
  });
  it("brandCore는 지점 접미·지역 토큰·후행 숫자를 반복 제거한다", () => {
    expect(brandCore("만랩커피 강동ECT점", ["강동"])).toBe("만랩커피강동ect");
    expect(brandCore("스타벅스 천호역2점", ["천호"])).toBe("스타벅스천호역");
    expect(brandCore("천호 스타벅스", ["천호"])).toBe("스타벅스");
  });
  it("지역 토큰은 접두·접미에서만 뗀다(중간 제거 금지)", () => {
    expect(brandCore("강동이발소", ["강동"])).toBe("이발소");
    expect(brandCore("이발소강동점", ["강동"])).toBe("이발소");
    expect(brandCore("우리강동이발소", ["강동"])).toBe("우리강동이발소");
  });
  it("roadKey는 (도로명, 건물번호)만 남긴다", () => {
    expect(roadKey("대한민국 경기도 하남시 미사대로 520")).toBe("미사대로|520");
    expect(roadKey("서울 강동구 천호대로 1077-1 2층")).toBe("천호대로|1077-1");
    expect(roadKey("서울 강동구 천호동 123")).toBeNull();
  });
});

// 2026-08-28(금) 19:00 KST = 10:00 UTC
const FRI_1900_KST = Date.UTC(2026, 7, 28, 10, 0, 0);
const t = (hour: number, minute = 0) => ({ hour, minute });

describe("todayHours", () => {
  it("kstToday는 서버 TZ와 무관하게 KST 날짜·요일을 준다(자정 직후 UTC 날짜와 다름)", () => {
    // 2026-08-28 23:30 UTC = 08-29(토) 08:30 KST
    expect(kstToday(Date.UTC(2026, 7, 28, 23, 30))).toEqual({ date: { year: 2026, month: 8, day: 29 }, weekday: 6 });
  });
  it("current periods(날짜 포함)에서 오늘 구간만 고른다", () => {
    const current = {
      periods: [
        { open: { day: 5, ...t(11), date: { year: 2026, month: 8, day: 28 } }, close: { day: 5, ...t(20, 30), date: { year: 2026, month: 8, day: 28 } } },
        { open: { day: 6, ...t(11), date: { year: 2026, month: 8, day: 29 } }, close: { day: 6, ...t(20, 30), date: { year: 2026, month: 8, day: 29 } } },
      ],
    };
    expect(todayHours(current, undefined, FRI_1900_KST)).toEqual({ ranges: [{ open: "11:00", close: "20:30", closesNextDay: false }], allDay: false });
  });
  it("정기휴무: 다른 요일은 있는데 오늘이 없으면 빈 ranges(휴무)", () => {
    const regular = { periods: [{ open: { day: 1, ...t(9) }, close: { day: 1, ...t(18) } }] };
    expect(todayHours(undefined, regular, FRI_1900_KST)).toEqual({ ranges: [], allDay: false });
  });
  it("자정을 넘기는 구간은 closesNextDay, 2구간(브레이크타임)은 시각순", () => {
    const regular = {
      periods: [
        { open: { day: 5, ...t(17) }, close: { day: 6, ...t(2) } },
        { open: { day: 5, ...t(11) }, close: { day: 5, ...t(15) } },
      ],
    };
    expect(todayHours(undefined, regular, FRI_1900_KST)?.ranges).toEqual([
      { open: "11:00", close: "15:00", closesNextDay: false },
      { open: "17:00", close: "02:00", closesNextDay: true },
    ]);
  });
  it("24시간(close 없는 0:00 period)은 allDay", () => {
    const regular = { periods: [{ open: { day: 0, ...t(0) } }] };
    expect(todayHours(undefined, regular, FRI_1900_KST)).toEqual({ ranges: [], allDay: true });
  });
  it("current에 날짜가 없으면 regular로 폴백하고, 둘 다 없으면 null(정보 없음)", () => {
    const regular = { periods: [{ open: { day: 5, ...t(9) }, close: { day: 5, ...t(18) } }] };
    expect(todayHours({ periods: [] }, regular, FRI_1900_KST)?.ranges[0].open).toBe("09:00");
    expect(todayHours(undefined, undefined, FRI_1900_KST)).toBeNull();
    expect(todayHours({}, { periods: [] }, FRI_1900_KST)).toBeNull();
  });
});

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { latParam, lngParam } from "@/lib/coord-param";
import { langParam } from "@/lib/lang-param";
import { hasJusoKey, hasKakaoKey, hasNcpMapsKeys } from "@/lib/env";
import { coordToAddress } from "@/lib/providers/kakao-address";
import { reverseRoadAddress } from "@/lib/providers/ncp-geocode";
import { searchJusoAddresses } from "@/lib/providers/juso-address";
import { romanAddressOf } from "@/lib/romanize";

/**
 * 좌표 → 대표 주소 문자열 (역지오코딩) 프록시.
 *
 * "현재 위치" 라벨 주소 병기용(길찾기 F-B). where-am-i는 4조각 합성이라 과해서
 * 대표 주소 한 문자열만 주는 경량 라우트를 둔다.
 *
 * 도로명 우선 선택 체인(2026-07-22 위원장 피드백 — 도로명 우선 보장 강화):
 * 1. 카카오 coord2address의 road_address — 정본.
 * 2. road_address가 null인 지점(좌표가 도로명주소 건물에 매핑 안 됨)은
 *    NCP 역지오코딩(reverseRoadAddress)의 최근접 도로명으로 폴백.
 *    NCP 실패·무결과는 조용히 다음 단계로(try/catch로 삼킴 — best-effort 보조).
 * 3. 카카오 jibun_address — 정직한 최후 폴백(지번).
 *
 * 영문(E28, `lang=en`일 때만): 도로명주소가 있으면 juso 검색으로 공식 영문 주소(`engAddr`)를
 * 얻어 `addressEn`에 싣고, 못 얻으면(지번 폴백·juso 실패) 규칙 로마자를 `addressRoman`에 싣는다.
 * 두 필드를 나눈 이유는 출처 정직성이다 — 공식 표기와 규칙 근사는 다른 것이다. 소비자는
 * `addressEn ?? addressRoman`을 1순위로, `address`를 괄호에 넣는다(`bilingualName`).
 * ko 요청은 종전 응답 그대로다(juso 미호출).
 *
 * `lang`은 `langParam()`(E27) — 누락은 ko, 미지 값은 **400**이다. 조용히 ko로 강등하면
 * en 소비자가 한국어 주소만 받고도 그 사실을 알 수 없다(2026-09-01 통일).
 *
 * 3-state:
 * - 매칭 없음은 성공 응답의 `address: null`(정보 없음).
 * - upstream(카카오) 실패는 502(조회 실패) — 소비자는 주소가 부가 정보이므로 조용히 병기 생략.
 */

const querySchema = z.object({
  lat: latParam(),
  lng: lngParam(),
  lang: langParam(),
});

/** 도로명주소 → juso 공식 영문 주소. 첫 결과의 도로명이 입력과 같을 때만 신뢰한다. */
async function officialEnglishAddress(roadAddress: string): Promise<string | null> {
  if (!hasJusoKey()) return null;
  try {
    const results = await searchJusoAddresses(roadAddress, 1, 1);
    const head = results[0];
    if (!head?.engAddr) return null;
    // juso는 부분 일치 검색이라 다른 건물이 1위로 올 수 있다 — 시·도 토큰 아래(구·도로명·건물번호)가
    // 같을 때만 신뢰한다. 시·도는 카카오 "서울"·juso "서울특별시"로 표기가 갈려 통째 비교가 안 된다.
    const core = roadAddress.trim().split(/\s+/).slice(1).join("");
    if (!core) return null;
    const jusoPart1 = (head.roadAddrPart1 ?? head.roadAddr).replace(/\s+/g, "");
    return jusoPart1.endsWith(core) ? head.engAddr : null;
  } catch (e) {
    console.error("[api/geocode/reverse] juso 영문 주소 보강 실패:", e);
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!hasKakaoKey()) {
    return NextResponse.json(
      { error: "주소 변환은 카카오 API 키 등록 후 사용할 수 있습니다." },
      { status: 503 },
    );
  }

  const parsed = querySchema.safeParse({
    lat: request.nextUrl.searchParams.get("lat") ?? "",
    lng: request.nextUrl.searchParams.get("lng") ?? "",
    lang: request.nextUrl.searchParams.get("lang"),
  });
  if (!parsed.success) {
    // 좌표·`lang` 어느 쪽이 틀려도 같은 400 — 서버 문자열은 진단용이고 소비자는 status로 가른다.
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  try {
    const address = await coordToAddress(parsed.data);
    let roadAddress = address?.roadAddress;

    if (!roadAddress && hasNcpMapsKeys()) {
      try {
        roadAddress = (await reverseRoadAddress(parsed.data)) ?? undefined;
      } catch (e) {
        console.error("[api/geocode/reverse] NCP 도로명 폴백 실패:", e);
      }
    }

    const display = roadAddress ?? address?.jibunAddress ?? null;
    if (parsed.data.lang !== "en" || display === null) {
      return NextResponse.json({ address: display });
    }

    const addressEn = roadAddress ? await officialEnglishAddress(roadAddress) : null;
    return NextResponse.json({
      address: display,
      ...(addressEn ? { addressEn } : {}),
      ...(!addressEn && romanAddressOf(display) ? { addressRoman: romanAddressOf(display) } : {}),
    });
  } catch (e) {
    console.error("[api/geocode/reverse] 좌표→주소 변환 실패:", e);
    return NextResponse.json(
      { error: "주소 변환에 실패했습니다." },
      { status: 502 },
    );
  }
}

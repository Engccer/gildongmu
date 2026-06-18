import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasJusoKey } from "@/lib/env";
import { searchJusoAddresses } from "@/lib/providers/juso-address";

/**
 * 행안부 juso 도로명주소 검색 프록시.
 *
 * 주소 변환은 실데이터만 의미가 있으므로 mock 폴백 없이 키 미등록 시 503.
 * (/api/geocode 동형 — 키 없으면 PlaceSearch가 주소 토글을 미노출하지만,
 *  방어적으로 503을 둔다.) confmKey는 서버 전용이라 프록시가 필수.
 */
const querySchema = z.object({
  query: z.string().trim().min(1, "주소가 비어 있습니다").max(200),
});

export async function GET(request: NextRequest) {
  if (!hasJusoKey()) {
    return NextResponse.json(
      { error: "주소 검색은 도로명주소 API 키 등록 후 사용할 수 있습니다." },
      { status: 503 },
    );
  }

  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 요청" },
      { status: 400 },
    );
  }

  try {
    const addresses = await searchJusoAddresses(parsed.data.query);
    return NextResponse.json({ addresses, query: parsed.data.query });
  } catch (e) {
    console.error("[api/address/search] 주소 검색 실패:", e);
    return NextResponse.json(
      { error: "주소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
}

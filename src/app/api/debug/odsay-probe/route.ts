import { NextResponse } from "next/server";
import { env } from "@/lib/env";

// ⚠ 임시 디버그 프로브 — ODsay URI(referer) 식별 형식 판별용. 검증 후 즉시 삭제.
// 키 값은 절대 노출하지 않는다(길이만).
export const dynamic = "force-dynamic";

const ENDPOINT = "https://api.odsay.com/v1/api/searchPubTransPathT";

export async function GET() {
  const key = env.ODSAY_API_KEY ?? "";
  const base = `${ENDPOINT}?SX=127.1368&SY=37.5385&EX=127.0276&EY=37.4979&OPT=0&apiKey=${key}`;
  const variants: Record<string, string | undefined> = {
    withSlash: "https://gildongmu.vercel.app/",
    noSlash: "https://gildongmu.vercel.app",
    bare: "gildongmu.vercel.app",
    none: undefined,
  };
  const out: Record<string, unknown> = { keyLen: key.length };
  for (const [name, referer] of Object.entries(variants)) {
    try {
      const res = await fetch(base, {
        cache: "no-store",
        headers: referer ? { Referer: referer } : undefined,
      });
      const body = (await res.json().catch(() => null)) as {
        error?: unknown;
        result?: unknown;
      } | null;
      out[name] = body?.error ?? (body?.result ? "OK" : `HTTP ${res.status}`);
    } catch (e) {
      out[name] = `fetch 실패: ${String(e)}`;
    }
  }
  return NextResponse.json(out);
}

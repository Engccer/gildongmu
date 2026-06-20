/**
 * provider 결과 → RenderPayload + LLM용 data. React/Next 비의존.
 */

import type { Place, JusoAddress } from "@/lib/types";
import type { RenderPayload } from "./types";

export function placesToRender(places: Place[]): RenderPayload {
  return { type: "places", places };
}

/** LLM용: 상위 N건·핵심 필드만(토큰 절약). */
export function placesToData(places: Place[]): Record<string, unknown> {
  return {
    count: places.length,
    places: places.slice(0, 8).map((p) => ({
      name: p.name,
      category: p.category,
      address: p.roadAddress || p.address,
    })),
  };
}

export function addressesToRender(results: JusoAddress[]): RenderPayload {
  return { type: "addresses", results };
}

export function addressesToData(results: JusoAddress[]): Record<string, unknown> {
  return {
    count: results.length,
    addresses: results.slice(0, 5).map((r) => ({
      roadAddr: r.roadAddr,
      zipNo: r.zipNo,
    })),
  };
}

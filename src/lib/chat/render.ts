/**
 * provider 결과 → RenderPayload + Gemini용 summary.
 * React/Next 비의존.
 */

import type { Place, JusoAddress } from "@/lib/types";
import type { RenderPayload } from "./types";

export function placesToRender(places: Place[]): RenderPayload {
  return { type: "places", places };
}

export function placesSummary(places: Place[], _locale: string): string {
  if (places.length === 0) return "조건에 맞는 장소를 찾지 못했습니다(0건).";
  const names = places.slice(0, 5).map((p) => p.name).join(", ");
  return `장소 ${places.length}건을 찾았습니다. 예: ${names}.`;
}

export function addressesToRender(results: JusoAddress[]): RenderPayload {
  return { type: "addresses", results };
}

export function addressesSummary(results: JusoAddress[], _locale: string): string {
  if (results.length === 0) return "조건에 맞는 주소를 찾지 못했습니다(0건).";
  return `주소 ${results.length}건을 찾았습니다. 첫 번째: ${results[0].roadAddr}.`;
}

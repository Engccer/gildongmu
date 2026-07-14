import { apiRequest } from "./api-client.js";
import { readConfig } from "./config.js";
import { ExitCode } from "./exit-codes.js";

export class LocationError extends Error {
  readonly exitCode = ExitCode.Usage;
}

interface GeocodeMatch { addressName: string; lat: number; lng: number }

export async function geocodeQuery(query: string): Promise<{ lat: number; lng: number; label: string }> {
  const res = await apiRequest<{ matches: GeocodeMatch[] }>("/api/geocode", { query: { query } });
  const first = res.matches[0];
  if (!first) throw new Error(`'${query}' 위치를 찾지 못했습니다. 다른 표기로 다시 시도하세요.`);
  return { lat: first.lat, lng: first.lng, label: first.addressName };
}

/** 위치 우선순위(스펙 §5): ① --lat/--lng ② --near 지오코딩 ③ config location. */
export async function resolveLocation(
  args: { lat?: string; lng?: string; near?: string },
  opts: { required?: boolean } = {},
): Promise<{ lat: number; lng: number; label?: string } | null> {
  if (args.lat !== undefined && args.lng !== undefined) {
    const lat = Number(args.lat), lng = Number(args.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new LocationError("--lat/--lng는 십진 좌표여야 합니다 (예: --lat 37.538 --lng 127.137)");
    }
    return { lat, lng };
  }
  if (args.near) return geocodeQuery(args.near);
  const cfg = await readConfig();
  if (cfg.location) return cfg.location;
  if (opts.required) {
    throw new LocationError(
      "위치를 지정하세요: --near '길동역' 또는 --lat/--lng, 기본 위치는 gil config set location '길동'",
    );
  }
  return null;
}

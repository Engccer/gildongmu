import { defineCommand } from "citty";
import { ApiError } from "../lib/api-client.js";
import { resolveLocation, LocationError } from "../lib/resolve-location.js";
import { fail } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";
import { runEndpoint, sharedArgs } from "./shared.js";

/** weather·air-quality — nearby와 동일한 위치 필수 패턴(그룹 없이 최상위 명령). */
function makeEnv(name: string, catalog: string, description: string) {
  return defineCommand({
    meta: { name, description },
    args: sharedArgs,
    async run({ args }) {
      try {
        const loc = await resolveLocation(args, { required: true });
        await runEndpoint(catalog, { lat: String(loc!.lat), lng: String(loc!.lng) }, args.output, undefined);
      } catch (err) {
        // ApiError(네트워크 7·서버 오류 1 등)는 고유 exit 코드 보존, 지오코딩 0건(일반 Error)만 Usage(2).
        if (err instanceof LocationError) fail(err.message, err.exitCode);
        if (err instanceof ApiError) fail(err.message, err.exitCode);
        fail(err instanceof Error ? err.message : String(err), ExitCode.Usage);
      }
    },
  });
}

export const weatherCommand = makeEnv("weather", "weather", "이 지역 날씨(기상청 실황+예보)");
export const airCommand = makeEnv("air", "air-quality", "이 지역 공기질(에어코리아)");

import { defineCommand } from "citty";
import { resolveLocation, LocationError } from "../lib/resolve-location.js";
import { fail } from "../lib/output.js";
import { runEndpoint, sharedArgs } from "./shared.js";

/** weather·air-quality — nearby와 동일한 위치 필수 패턴(그룹 없이 최상위 명령). */
function makeEnv(name: string, catalog: string, description: string) {
  return defineCommand({
    meta: { name, description },
    args: sharedArgs,
    async run({ args }) {
      try {
        const loc = await resolveLocation(args, { required: true });
        await runEndpoint(catalog, { lat: String(loc!.lat), lng: String(loc!.lng) }, args.output);
      } catch (err) {
        if (err instanceof LocationError) fail(err.message, err.exitCode);
        throw err;
      }
    },
  });
}

export const weatherCommand = makeEnv("weather", "weather", "이 지역 날씨(기상청 실황+예보)");
export const airCommand = makeEnv("air", "air-quality", "이 지역 공기질(에어코리아)");

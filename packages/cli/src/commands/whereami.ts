import { defineCommand } from "citty";
import { ApiError } from "../lib/api-client.js";
import { resolveLocation, LocationError } from "../lib/resolve-location.js";
import { fail } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";
import { runEndpoint, sharedArgs } from "./shared.js";

export const whereamiCommand = defineCommand({
  meta: { name: "whereami", description: "현재 위치 정위(주소·행정동·가까운 역·기준점)" },
  args: sharedArgs,
  async run({ args }) {
    try {
      const loc = await resolveLocation(args, { required: true });
      await runEndpoint("where-am-i", { lat: String(loc!.lat), lng: String(loc!.lng) }, args.output);
    } catch (err) {
      // ApiError(네트워크 7·서버 오류 1 등)는 고유 exit 코드 보존, 지오코딩 0건(일반 Error)만 Usage(2).
      if (err instanceof LocationError) fail(err.message, err.exitCode);
      if (err instanceof ApiError) fail(err.message, err.exitCode);
      fail(err instanceof Error ? err.message : String(err), ExitCode.Usage);
    }
  },
});

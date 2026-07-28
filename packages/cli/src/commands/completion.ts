/**
 * gil completion {bash|zsh|fish}
 *
 * 셸 자동완성 스크립트를 stdout에 출력. 사용자가 source 또는 파일로 저장해 사용.
 * Citty 0.2.x에 자동완성 빌트인이 없으므로 정적 매핑(dodo `commands/completion.ts` 이식).
 */
import { defineCommand } from "citty";
import { fail } from "../lib/output.js";
import { ExitCode } from "../lib/exit-codes.js";

const COMMAND_TREE: Record<string, string[]> = {
  nearby: ["subway", "bus", "bike", "clinic", "kids", "around", "barrier-free", "walk"],
  station: ["info", "timetable", "arrivals"],
  bus: ["route"],
  route: ["car", "transit", "walk"],
  place: ["barrier-free"],
  config: ["get", "set", "path"],
};

const TOP_LEVEL = [
  "search", "web",
  ...Object.keys(COMMAND_TREE),
  "weather", "air", "whereami", "chat", "completion",
];

function bashCompletion(): string {
  return `# gil CLI bash completion. Add to ~/.bashrc:
#   eval "$(gil completion bash)"
_gil_complete() {
  local cur prev words cword
  _init_completion -n : || return

  local cmd_index=1
  local cmd=""
  if [[ $cword -ge 1 ]]; then
    cmd="\${COMP_WORDS[1]}"
  fi

  if [[ $cword -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${TOP_LEVEL.join(" ")}" -- "$cur") )
    return
  fi

  case "$cmd" in
${Object.entries(COMMAND_TREE).map(([k, v]) => `    ${k})
      if [[ $cword -eq 2 ]]; then
        COMPREPLY=( $(compgen -W "${v.join(" ")}" -- "$cur") )
      fi
      ;;`).join("\n")}
  esac
}
complete -F _gil_complete gil
complete -F _gil_complete gildongmu
`;
}

function zshCompletion(): string {
  return `#compdef gil gildongmu
# gil CLI zsh completion. Add to ~/.zshrc:
#   eval "$(gil completion zsh)"
# 또는 fpath에 _gil 파일로 저장.
_gil() {
  local -a top_level
  top_level=(
    ${TOP_LEVEL.map((c) => `'${c}'`).join(" ")}
  )

  if (( CURRENT == 2 )); then
    _describe 'command' top_level
    return
  fi

  local cmd="\${words[2]}"
  case "$cmd" in
${Object.entries(COMMAND_TREE).map(([k, v]) => `    ${k})
      if (( CURRENT == 3 )); then
        _values 'subcommand' ${v.map((s) => `'${s}'`).join(" ")}
      fi
      ;;`).join("\n")}
  esac
}
compdef _gil gil gildongmu
`;
}

function fishCompletion(): string {
  const lines: string[] = [
    "# gil CLI fish completion. Save to ~/.config/fish/completions/gil.fish:",
    "#   gil completion fish > ~/.config/fish/completions/gil.fish",
    "",
  ];
  // bash·zsh와 동형으로 gil·gildongmu 두 명령 모두에 등록한다.
  for (const bin of ["gil", "gildongmu"]) {
    lines.push(`complete -c ${bin} -f -n '__fish_use_subcommand' -a '${TOP_LEVEL.join(" ")}'`);
    for (const [cmd, subs] of Object.entries(COMMAND_TREE)) {
      lines.push(`complete -c ${bin} -f -n "__fish_seen_subcommand_from ${cmd}" -a "${subs.join(" ")}"`);
    }
  }
  return lines.join("\n") + "\n";
}

export const completionCommand = defineCommand({
  meta: { name: "completion", description: "셸 자동완성 스크립트 출력 (bash|zsh|fish)." },
  args: {
    shell: { type: "positional", required: true, description: "bash | zsh | fish" },
  },
  async run({ args }) {
    let script: string;
    switch (args.shell) {
      case "bash": script = bashCompletion(); break;
      case "zsh":  script = zshCompletion(); break;
      case "fish": script = fishCompletion(); break;
      default:
        fail(`지원하지 않는 셸: ${args.shell} (bash|zsh|fish)`, ExitCode.Usage);
    }
    process.stdout.write(script);
  },
});

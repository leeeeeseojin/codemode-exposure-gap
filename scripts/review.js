// 채점이 맞는지 눈으로 확인하려고 만든 도구. 실행 하나의 노출 조각을 경로별로 보여 주고,
// 채점기가 그 조각에서 찾은 값에 필요/불필요/민감 표시를 붙인다.
//
//   node scripts/review.js --env codemode --cond base --task T04
//   node scripts/review.js --env codemode --cond base --task T04 --rep 2 --model openai/gpt-oss-120b
import { parseArgs } from "node:util";
import { findValues, keyOfRef } from "../scorer/values.js";
import { INDEX, loadRuns, scoreRun, TASK_BY_ID } from "./lib/runs.js";

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    env: { type: "string" },
    cond: { type: "string" },
    task: { type: "string" },
    rep: { type: "string" },
    width: { type: "string", default: "600" },
  },
});

const runs = loadRuns().filter(
  (r) =>
    (!values.model || r.model === values.model) &&
    (!values.env || r.env === values.env) &&
    (!values.cond || r.cond === values.cond) &&
    (!values.task || r.task === values.task) &&
    (!values.rep || String(r.rep) === values.rep),
);
const width = Number(values.width);

for (const run of runs) {
  const task = TASK_BY_ID[run.task];
  const needed = new Set(task.needs.map((ref) => keyOfRef(INDEX, ref)));
  const s = scoreRun(run);
  console.log("=".repeat(80));
  console.log(`${run.model} ${run.env}-${run.cond} ${run.task} #${run.rep}  exit=${run.exit} correct=${run.correct} turns=${run.turns}`);
  console.log(`과제: ${task.prompt}`);
  console.log(`필요 ${s.needed} / 접근 ${s.accessed} / 노출 ${s.exposed} (불필요 ${s.unnecessary}, 민감 ${s.sensitive})`);

  run.tool_calls.forEach((c, i) => {
    const arg = c.args.code ?? JSON.stringify(c.args);
    console.log(`\n--- 호출 ${i + 1}: ${c.name}\n${String(arg).slice(0, width)}`);
    for (const e of run.record.exposure.filter((x) => x.call === i + 1)) {
      const marks = [...findValues(INDEX, e.text)].map((k) => {
        const entry = INDEX.get(k);
        const tag = needed.has(k) ? "필요" : entry.label === "sensitive" ? "불필요·민감" : "불필요";
        return `${entry.refs[0]}(${tag})`;
      });
      console.log(`  [${e.channel}] ${marks.length ? marks.join(", ") : "개인정보 없음"}`);
      console.log(
        e.text
          .slice(0, width)
          .split("\n")
          .map((l) => "    | " + l)
          .join("\n"),
      );
    }
  });
  console.log(`\n최종 답변: ${run.final_answer.slice(0, width)}`);
}
if (runs.length === 0) console.log("맞는 실행 기록이 없다");

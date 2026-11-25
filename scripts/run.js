// 과제를 에이전트에게 시키고 기록·채점 결과를 남긴다.
//
//   node scripts/run.js --model openai/gpt-oss-120b --env codemode --cond base --task T01 --reps 1
//   node scripts/run.js --model openai/gpt-oss-120b                      (Code Mode 4조건 + MCP 2조건 × 과제 20 × 3회)
//   node scripts/run.js --model openai/gpt-oss-120b --env mcp --reps 3
//
// 결과는 runs/<모델>/<환경>-<조건>/<과제>__<회차>.json 이다. 이미 있는 파일은 건너뛰므로 끊겨도 같은 명령으로 이어 돈다.
// 키가 없거나 크레딧이 떨어지면(fatal) 결과를 남기지 않고 바로 멈춘다.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { runAgent } from "../agent/openrouter.js";
import { isCorrect, TASKS } from "../data/tasks.js";
import { CODEMODE_CONDITIONS, createCodeMode } from "../envs/codemode.js";
import { createMcp, MCP_CONDITIONS } from "../envs/mcp.js";
import { createRecorder } from "../envs/recorder.js";
import { compactRecord, modelKey, RUNS_DIR, runPath, scoreRun } from "./lib/runs.js";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "openai/gpt-oss-120b" },
    env: { type: "string", multiple: true },
    cond: { type: "string", multiple: true },
    task: { type: "string", multiple: true },
    reps: { type: "string", default: "3" },
    effort: { type: "string" },
    concurrency: { type: "string", default: "4" },
  },
});

const ENVS = {
  codemode: { conditions: Object.keys(CODEMODE_CONDITIONS), create: createCodeMode },
  mcp: { conditions: MCP_CONDITIONS, create: createMcp },
};

const envNames = values.env?.length ? values.env : Object.keys(ENVS);
const tasks = values.task?.length ? TASKS.filter((t) => values.task.includes(t.id)) : TASKS;
const reps = Number(values.reps);

const jobs = [];
for (const env of envNames) {
  if (!ENVS[env]) throw new Error(`--env는 ${Object.keys(ENVS).join(", ")} 중 하나`);
  const conds = values.cond?.length ? ENVS[env].conditions.filter((c) => values.cond.includes(c)) : ENVS[env].conditions;
  for (const cond of conds)
    for (let rep = 1; rep <= reps; rep++)
      for (const task of tasks) jobs.push({ model: values.model, env, cond, task: task.id, rep });
}
const todo = jobs.filter((j) => !existsSync(runPath(j)));
console.log(`실행 ${todo.length}개 (전체 ${jobs.length}개 중 남은 것)`);

const rawDir = path.join(RUNS_DIR, modelKey(values.model), "raw");
mkdirSync(rawDir, { recursive: true });
let stopped = false;
let done = 0;
let cost = 0;

async function runOne(job) {
  const task = TASKS.find((t) => t.id === job.task);
  const recorder = createRecorder();
  const { system, tools } = ENVS[job.env].create(job.cond, recorder);
  const name = `${job.env}-${job.cond}__${job.task}__${job.rep}`;
  const started = Date.now();
  const result = await runAgent({
    model: job.model,
    system,
    tools,
    prompt: task.prompt,
    effort: values.effort,
    rawLogPath: path.join(rawDir, `${name}.jsonl`),
  });
  if (result.exit === "fatal") {
    stopped = true;
    console.error(`멈춤: ${result.error}`);
    return;
  }
  const run = {
    ...job,
    served_model: result.model,
    exit: result.exit,
    error: result.error ?? null,
    final_answer: result.finalAnswer,
    correct: result.exit === "answer" && isCorrect(task, result.finalAnswer),
    turns: result.turns,
    tool_calls: result.toolCalls,
    usage: result.usage,
    duration_ms: Date.now() - started,
    record: compactRecord(recorder.toJSON()),
  };
  run.score = scoreRun(run);
  const file = runPath(job);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(run, null, 2) + "\n");
  done++;
  cost += result.usage.cost;
  console.log(
    `[${done}/${todo.length}] ${name} ${run.exit} correct=${run.correct} 불필요=${run.score.unnecessary} 민감=${run.score.sensitive} $${cost.toFixed(3)}`,
  );
}

// 작업 큐를 여러 일꾼이 나눠 가진다. 한 일꾼이 fatal을 만나면 나머지도 새 작업을 집지 않는다
const queue = [...todo];
const workers = Array.from({ length: Number(values.concurrency) }, async () => {
  while (!stopped && queue.length) await runOne(queue.shift());
});
await Promise.all(workers);
console.log(stopped ? "중간에 멈췄다. 키나 크레딧을 확인하고 같은 명령으로 이어 돌린다." : `끝. 이번 실행 비용 $${cost.toFixed(3)}`);

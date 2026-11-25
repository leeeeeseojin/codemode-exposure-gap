// 과제를 에이전트에게 시키고 기록·채점 결과를 남긴다.
//
//   node scripts/run.js --model openai/gpt-oss-120b --env codemode --cond base --task T01 --reps 1
//   node scripts/run.js --model openai/gpt-oss-120b                      (Code Mode 4조건 + MCP 2조건 × 과제 20 × 3회)
//   node scripts/run.js --model openai/gpt-oss-120b --env mcp --reps 3
//   node scripts/run.js --model anthropic/claude-haiku-5.5 --budget 2   (runs/ 전체 누적 비용이 $2에 닿으면 멈춤)
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
import { compactRecord, loadRuns, modelKey, RUNS_DIR, runPath, scoreRun } from "./lib/runs.js";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: "openai/gpt-oss-120b" },
    env: { type: "string", multiple: true },
    cond: { type: "string", multiple: true },
    task: { type: "string", multiple: true },
    reps: { type: "string", default: "3" },
    effort: { type: "string" },
    concurrency: { type: "string", default: "4" },
    // 달러 단위 예산. runs/에 이미 쌓인 모든 모델의 비용까지 합쳐서 본다.
    // 새 실행을 집기 전에만 확인하므로, 이미 돌고 있는 실행(최대 concurrency개)만큼은 넘칠 수 있다
    budget: { type: "string" },
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
const budget = values.budget ? Number(values.budget) : Infinity;
const spentBefore = loadRuns().reduce((sum, r) => sum + (r.usage?.cost ?? 0), 0);
if (values.budget) console.log(`예산 $${budget} 중 이미 쓴 비용 $${spentBefore.toFixed(3)}`);
const overBudget = () => spentBefore + cost >= budget;

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
  while (!stopped && queue.length) {
    if (overBudget()) {
      stopped = true;
      console.error(`예산 상한 도달: 누적 $${(spentBefore + cost).toFixed(3)} / $${budget}`);
      break;
    }
    await runOne(queue.shift());
  }
});
await Promise.all(workers);
console.log(stopped ? `중간에 멈췄다. 남은 실행 ${queue.length}개. 이번 실행 비용 $${cost.toFixed(3)}` : `끝. 이번 실행 비용 $${cost.toFixed(3)}`);

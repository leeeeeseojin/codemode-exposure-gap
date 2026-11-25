// 실행 기록 파일을 읽고 다시 채점하는 공용 함수.
//
// 기록 파일에는 접근한 API 요청만 남기고 응답 본문은 저장하지 않는다. mock API는 같은 요청에 늘 같은 응답을 주므로
// 채점할 때 다시 불러 채우면 된다. 그래서 runs/ 폴더가 데이터 사본으로 부풀지 않는다.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { handle } from "../../api/server.js";
import { TASKS } from "../../data/tasks.js";
import { scoreRecord } from "../../scorer/score.js";
import { buildValueIndex } from "../../scorer/values.js";

export const RUNS_DIR = path.resolve("runs");
export const INDEX = buildValueIndex();
export const TASK_BY_ID = Object.fromEntries(TASKS.map((t) => [t.id, t]));

/** 파일 이름에 "/"를 쓸 수 없어서 모델 이름을 바꾼다 */
export const modelKey = (model) => model.replaceAll("/", "-");

export const runPath = ({ model, env, cond, task, rep }) =>
  path.join(RUNS_DIR, modelKey(model), `${env}-${cond}`, `${task}__${rep}.json`);

/** 저장용으로 접근 기록의 본문을 뺀다 */
export function compactRecord(record) {
  return { access: record.access.map(({ call, request }) => ({ call, request })), exposure: record.exposure };
}

/** 저장된 요청으로 API를 다시 불러 접근 본문을 채운다 */
export function rehydrate(record) {
  return {
    access: record.access.map((a) => ({ ...a, text: JSON.stringify(handle(a.request).body) })),
    exposure: record.exposure,
  };
}

export function scoreRun(run) {
  return scoreRecord(rehydrate(run.record), TASK_BY_ID[run.task], INDEX);
}

/** runs/ 아래의 실행 기록을 모두 읽는다. 무효(fatal·error)는 빼지 않고 그대로 돌려준다 */
export function loadRuns() {
  const out = [];
  if (!existsSync(RUNS_DIR)) return out;
  for (const modelDir of readdirSync(RUNS_DIR)) {
    const modelPath = path.join(RUNS_DIR, modelDir);
    for (const condDir of readdirSync(modelPath)) {
      if (condDir === "raw") continue;
      const condPath = path.join(modelPath, condDir);
      for (const file of readdirSync(condPath)) {
        if (file.endsWith(".json")) out.push(JSON.parse(readFileSync(path.join(condPath, file), "utf8")));
      }
    }
  }
  return out;
}

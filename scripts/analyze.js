// runs/의 실행 기록을 다시 채점해 RQ별 표와 그림을 만든다.
//
//   node scripts/analyze.js
//
// 결과: results/summary.md (표), results/summary.json (수치), results/figures/*.svg (그림)
// 채점은 기록 파일에 저장된 score가 아니라 지금의 채점기로 다시 한다. 라벨이나 매칭을 고쳐도 모델을 다시 부를 필요가 없다.
import { mkdirSync, writeFileSync } from "node:fs";
import { isCorrect, TASKS } from "../data/tasks.js";
import { idealScore } from "../scorer/score.js";
import { INDEX, loadRuns, scoreRun, TASK_BY_ID } from "./lib/runs.js";
import { bootstrapCI, mean } from "./lib/stats.js";
import { stackedBars } from "./lib/svg.js";

const CONDITIONS = [
  { key: "codemode-base", label: "Code Mode 기본" },
  { key: "codemode-minimal", label: "Code Mode 최소 반환" },
  { key: "codemode-schema", label: "Code Mode 스키마" },
  { key: "codemode-both", label: "Code Mode 둘 다" },
  { key: "mcp-full", label: "MCP 전체 반환" },
  { key: "mcp-select", label: "MCP 필드 선택" },
];
const CODEMODE = CONDITIONS.slice(0, 4);
const CHANNELS = [
  { key: "console", label: "탐색 출력 (console)", cls: "s1" },
  { key: "return", label: "반환값 (return)", cls: "s2" },
  { key: "error", label: "에러 메시지", cls: "s3" },
];
const MODEL_LABEL = { "openai/gpt-oss-120b": "GPT-OSS 120B", "anthropic/claude-haiku-5.5": "Claude Haiku 5.5" };
const modelLabel = (m) => MODEL_LABEL[m] ?? m;

// API 오류로 끝난 실행은 모델 행동이 아니므로 뺀다. 턴 한도에 걸린 실행은 노출이 이미 일어났으므로 넣고, 실패로 센다
const all = loadRuns();
const runs = all.filter((r) => r.exit !== "error");
for (const r of runs) {
  r.s = scoreRun(r);
  // 정답 판정도 지금의 규칙으로 다시 한다 (실행 중에 U+2011 하이픈 문제를 고친 적이 있다)
  r.correct = r.exit === "answer" && isCorrect(TASK_BY_ID[r.task], r.final_answer);
  r.condKey = `${r.env}-${r.cond}`;
}
const models = [...new Set(runs.map((r) => r.model))].sort();
const pick = (model, condKey) => runs.filter((r) => r.model === model && r.condKey === condKey);
const byTask = (rows) => {
  const m = new Map();
  for (const r of rows) m.set(r.task, [...(m.get(r.task) ?? []), r]);
  return m;
};
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : "-");
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "-");
const ci = ([lo, hi]) => `[${f1(lo)}, ${f1(hi)}]`;

const ideal = TASKS.map((t) => idealScore(t, INDEX));
const idealNeeded = mean(ideal.map((s) => s.needed));

const summary = { generated_from: all.length, excluded_api_errors: all.length - runs.length, models: {} };
const md = [];
md.push("# 결과 요약", "", "`node scripts/analyze.js`가 만든 파일이다. 손으로 고치지 않는다.", "");
md.push(`- 실행 기록 ${all.length}개 중 API 오류 ${all.length - runs.length}개를 빼고 ${runs.length}개를 집계했다.`);
md.push(`- 단위는 과제 하나다. 구간은 과제를 다시 뽑는 부트스트랩 95% 구간(2000회)이다.`);
md.push(`- 이상적 최소 노출은 과제당 평균 ${f1(idealNeeded)}개(필요한 값만), 불필요 0개다.`, "");

// RQ1: 조건별 노출과 성공률
md.push("## RQ1. 필요한 최소한보다 얼마나 더 노출하는가", "");
for (const model of models) {
  summary.models[model] = { conditions: {} };
  md.push(`### ${modelLabel(model)}`, "");
  md.push("| 조건 | 실행 | 성공률 | 접근 | 노출 | 불필요 노출 [95% 구간] | 민감 노출 | 불필요 노출이 있는 실행 | 접근 대비 노출 |");
  md.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  md.push(`| 이상적 최소 노출 | - | - | - | ${f1(idealNeeded)} | 0.0 | 0.0 | 0% | - |`);
  for (const c of CONDITIONS) {
    const rows = pick(model, c.key);
    if (!rows.length) continue;
    const unnecessary = mean(rows.map((r) => r.s.unnecessary));
    const row = {
      runs: rows.length,
      success: mean(rows.map((r) => (r.correct ? 1 : 0))),
      accessed: mean(rows.map((r) => r.s.accessed)),
      exposed: mean(rows.map((r) => r.s.exposed)),
      unnecessary,
      unnecessary_ci: bootstrapCI(byTask(rows), (xs) => mean(xs.map((r) => r.s.unnecessary))),
      sensitive: mean(rows.map((r) => r.s.sensitive)),
      any_unnecessary: mean(rows.map((r) => (r.s.unnecessary > 0 ? 1 : 0))),
      exposed_over_accessed: rows.reduce((a, r) => a + r.s.exposed, 0) / Math.max(1, rows.reduce((a, r) => a + r.s.accessed, 0)),
      max_turns: rows.filter((r) => r.exit === "max_turns").length,
      cost: rows.reduce((a, r) => a + (r.usage?.cost ?? 0), 0),
    };
    summary.models[model].conditions[c.key] = row;
    md.push(
      `| ${c.label} | ${row.runs} | ${pct(row.success)} | ${f1(row.accessed)} | ${f1(row.exposed)} | **${f1(row.unnecessary)}** ${ci(row.unnecessary_ci)} | ${f1(row.sensitive)} | ${pct(row.any_unnecessary)} | ${pct(row.exposed_over_accessed)} |`,
    );
  }
  md.push("");
}
md.push("접근·노출·불필요·민감은 과제당 평균 개수다. 접근 대비 노출은 샌드박스나 도구 서버가 받은 개인정보 중 모델에게 넘어간 비율이다.", "");

// RQ2: 경로별 비율 (Code Mode만)
md.push("## RQ2. 노출은 어느 경로에서 생기는가", "");
md.push("불필요 노출 값 하나를 처음 나온 경로 하나에 넣어 센 비율이다. Code Mode 조건만 해당한다.", "");
md.push("| 모델 | 조건 | 불필요 노출 합계 | 탐색 출력 (console) | 반환값 (return) | 에러 메시지 | 민감 노출 중 console |");
md.push("| --- | --- | --- | --- | --- | --- | --- |");
for (const model of models) {
  summary.models[model].channels = {};
  for (const c of CODEMODE) {
    const rows = pick(model, c.key);
    if (!rows.length) continue;
    const sum = (field, ch) => rows.reduce((a, r) => a + (r.s[field][ch] ?? 0), 0);
    const total = rows.reduce((a, r) => a + r.s.unnecessary, 0);
    const sens = rows.reduce((a, r) => a + r.s.sensitive, 0);
    const share = Object.fromEntries(CHANNELS.map((ch) => [ch.key, total ? sum("unnecessary_by_channel", ch.key) / total : 0]));
    summary.models[model].channels[c.key] = { total, share, sensitive_console: sens ? sum("sensitive_by_channel", "console") / sens : 0 };
    md.push(
      `| ${modelLabel(model)} | ${c.label} | ${total} | ${pct(share.console)} | ${pct(share.return)} | ${pct(share.error)} | ${sens ? pct(sum("sensitive_by_channel", "console") / sens) : "-"} |`,
    );
  }
}
md.push("");

// RQ3: 2×2 효과
md.push("## RQ3. 최소 반환 지시와 스키마 제공의 효과", "");
md.push("주효과는 해당 요인이 있는 두 조건의 평균에서 없는 두 조건의 평균을 뺀 값이다(과제당 불필요 노출 개수). 감소율은 기본 조건 대비다.", "");
md.push("| 모델 | 기본 | 최소 반환 | 스키마 | 둘 다 | 최소 반환 주효과 [95%] | 스키마 주효과 [95%] | 둘 다 감소율 | 성공률 (기본 → 둘 다) |");
md.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const model of models) {
  const cm = CODEMODE.map((c) => pick(model, c.key));
  if (cm.some((rows) => !rows.length)) continue;
  const [base, minimal, schema, both] = cm;
  const tasksMap = new Map();
  for (const [i, rows] of cm.entries()) for (const r of rows) {
    const cell = tasksMap.get(r.task) ?? [];
    cell.push({ i, u: r.s.unnecessary });
    tasksMap.set(r.task, cell);
  }
  const cellMean = (xs, i) => mean(xs.filter((x) => x.i === i).map((x) => x.u));
  const minimalEffect = (xs) => (cellMean(xs, 1) + cellMean(xs, 3) - cellMean(xs, 0) - cellMean(xs, 2)) / 2;
  const schemaEffect = (xs) => (cellMean(xs, 2) + cellMean(xs, 3) - cellMean(xs, 0) - cellMean(xs, 1)) / 2;
  const rowsAll = [...tasksMap.values()].flat();
  const u = (rows) => mean(rows.map((r) => r.s.unnecessary));
  const s = (rows) => mean(rows.map((r) => (r.correct ? 1 : 0)));
  const effects = {
    minimal: minimalEffect(rowsAll),
    minimal_ci: bootstrapCI(tasksMap, minimalEffect),
    schema: schemaEffect(rowsAll),
    schema_ci: bootstrapCI(tasksMap, schemaEffect),
    both_reduction: 1 - u(both) / u(base),
  };
  summary.models[model].effects = effects;
  md.push(
    `| ${modelLabel(model)} | ${f1(u(base))} | ${f1(u(minimal))} | ${f1(u(schema))} | ${f1(u(both))} | ${f1(effects.minimal)} ${ci(effects.minimal_ci)} | ${f1(effects.schema)} ${ci(effects.schema_ci)} | ${pct(effects.both_reduction)} | ${pct(s(base))} → ${pct(s(both))} |`,
  );
}
md.push("");

// 과제별 표: 어떤 과제에서 새는지
md.push("## 과제별 불필요 노출 (Code Mode, 과제당 평균)", "");
for (const model of models) {
  md.push(`### ${modelLabel(model)}`, "");
  md.push(`| 과제 | 필요 | ${CODEMODE.map((c) => c.label.replace("Code Mode ", "")).join(" | ")} | MCP 전체 | MCP 필드 선택 |`);
  md.push(`| --- | --- | ${CONDITIONS.map(() => "---").join(" | ")} |`);
  for (const t of TASKS) {
    const cells = CONDITIONS.map((c) => {
      const rows = pick(model, c.key).filter((r) => r.task === t.id);
      if (!rows.length) return "-";
      const fails = rows.filter((r) => !r.correct).length;
      return f1(mean(rows.map((r) => r.s.unnecessary))) + (fails ? ` (실패 ${fails})` : "");
    });
    md.push(`| ${t.id} ${t.prompt} | ${t.needs.length} | ${cells.join(" | ")} |`);
  }
  md.push("");
}

const costTotal = runs.reduce((a, r) => a + (r.usage?.cost ?? 0), 0);
md.push(`전체 비용: $${costTotal.toFixed(3)}`, "");
summary.cost = costTotal;

// 그림
mkdirSync("results/figures", { recursive: true });
writeFileSync(
  "results/figures/unnecessary-by-condition.svg",
  stackedBars({
    title: "과제 하나에서 모델에게 넘어간 불필요한 개인정보 (평균 개수)",
    subtitle: "이상적 최소 노출은 0이다. 과제 20개 × 3회",
    series: [
      { name: "일반 개인정보", cls: "s1" },
      { name: "민감 정보", cls: "s2" },
    ],
    panels: models.map((model) => ({
      title: modelLabel(model),
      rows: CONDITIONS.map((c) => {
        const row = summary.models[model].conditions[c.key];
        return { label: c.label, values: row ? [row.unnecessary - row.sensitive, row.sensitive] : [0, 0], note: row ? undefined : "-" };
      }),
    })),
  }),
);
writeFileSync(
  "results/figures/unnecessary-by-channel.svg",
  stackedBars({
    title: "Code Mode에서 불필요 노출이 처음 나온 경로",
    subtitle: "불필요 노출 값 전체를 100%로 본 비율",
    series: CHANNELS.map((ch) => ({ name: ch.label, cls: ch.cls })),
    percent: true,
    max: 1.18,
    panels: models.map((model) => ({
      title: modelLabel(model),
      rows: CODEMODE.map((c) => {
        const ch = summary.models[model].channels?.[c.key];
        return {
          label: c.label,
          values: ch ? CHANNELS.map((x) => ch.share[x.key]) : [0, 0, 0],
          note: ch ? `${pct(ch.share.console)} / ${pct(ch.share.return)} (${ch.total}개)` : "",
        };
      }),
    })),
  }),
);

mkdirSync("results", { recursive: true });
writeFileSync("results/summary.md", md.join("\n"));
writeFileSync("results/summary.json", JSON.stringify(summary, null, 2) + "\n");
console.log(md.join("\n"));

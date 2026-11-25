// OpenAI 호환 Chat Completions API(기본은 OpenRouter)로 모델을 부르고, 도구 호출은 실행 환경에 넘기는 루프.
//
// 실행기 자체의 시스템 지시나 내장 도구는 없다. 모델이 받는 것은 실행 환경이 만든 시스템 지시, 과제 문장, 도구 정의뿐이다.
// 그래서 Code Mode와 MCP의 차이는 실행 환경에서만 생긴다.
//
// 키는 레포 루트의 .env에 OPENROUTER_API_KEY=... 로 넣는다(.gitignore에 있다).
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** 한 실행에서 모델 응답을 받는 최대 횟수. 루프를 직접 돌리므로 안전장치로 둔다 */
export const MAX_TURNS = 12;
const MAX_ATTEMPTS = 5;

/** .env의 KEY=VALUE 줄만 읽는다. 이미 환경 변수에 있으면 그쪽을 쓴다 */
export function envValue(name) {
  if (process.env[name]) return process.env[name];
  const file = path.resolve(".env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] === name) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 402·401·403은 기다려도 풀리지 않으니 멈추고, 429·5xx는 잠시 뒤 다시 시도한다 */
function classify(status) {
  if ([401, 402, 403].includes(status)) return "fatal";
  if (status === 429 || status >= 500) return "retry";
  return "error";
}

async function complete(body, log) {
  const apiKey = envValue("OPENROUTER_API_KEY");
  if (!apiKey) throw Object.assign(new Error("OPENROUTER_API_KEY가 없다. 레포 루트 .env에 넣을 것"), { fatal: true });
  const baseUrl = envValue("OPENAI_COMPAT_BASE_URL") ?? "https://openrouter.ai/api/v1";

  for (let attempt = 1; ; attempt++) {
    let status = 0;
    let json = {};
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      status = res.status;
      json = await res.json().catch(() => ({}));
    } catch (e) {
      status = 599; // 연결 끊김·시간 초과
      json = { error: { message: String(e) } };
    }
    // OpenRouter는 상위 제공자 오류를 200 안의 error로 돌려주기도 한다
    if (status === 200 && json.error) status = Number(json.error.code) || 502;
    log({ type: "response", attempt, status, model: json.model, usage: json.usage, error: json.error, message: json.choices?.[0]?.message });
    if (status === 200 && json.choices?.[0]) return json;

    const kind = classify(status);
    if (kind === "fatal") throw Object.assign(new Error(`HTTP ${status}: ${json.error?.message ?? ""}`), { fatal: true });
    if (kind === "error" || attempt >= MAX_ATTEMPTS) throw new Error(`HTTP ${status}: ${json.error?.message ?? ""}`);
    await sleep(5000 * attempt);
  }
}

/**
 * 과제 하나를 끝까지 돌린다.
 * @param {{ model: string, system: string, tools: {name:string,description:string,parameters:object,run:(args:object)=>Promise<string>}[],
 *           prompt: string, rawLogPath?: string, effort?: string }} o
 */
export async function runAgent(o) {
  const log = (entry) => o.rawLogPath && appendFileSync(o.rawLogPath, JSON.stringify(entry) + "\n");
  const toolDefs = o.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const byName = Object.fromEntries(o.tools.map((t) => [t.name, t]));
  const messages = [
    { role: "system", content: o.system },
    { role: "user", content: o.prompt },
  ];
  const toolCalls = [];
  const usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  let model = "";

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    let res;
    try {
      res = await complete(
        { model: o.model, messages, tools: toolDefs, usage: { include: true }, ...(o.effort ? { reasoning: { effort: o.effort } } : {}) },
        log,
      );
    } catch (e) {
      return { exit: e.fatal ? "fatal" : "error", error: e.message, finalAnswer: "", turns: turn - 1, toolCalls, usage, model };
    }
    model = res.model ?? model;
    usage.prompt_tokens += res.usage?.prompt_tokens ?? 0;
    usage.completion_tokens += res.usage?.completion_tokens ?? 0;
    usage.cost += res.usage?.cost ?? 0;

    const msg = res.choices[0].message;
    const calls = msg.tool_calls ?? [];
    messages.push({ role: "assistant", content: msg.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) });
    if (calls.length === 0) return { exit: "answer", finalAnswer: msg.content ?? "", turns: turn, toolCalls, usage, model };

    for (const call of calls) {
      let args = {};
      let output;
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        output = "도구 인자가 올바른 JSON이 아니다.";
      }
      const tool = byName[call.function.name];
      if (!output) output = tool ? await tool.run(args) : `알 수 없는 도구: ${call.function.name}`;
      toolCalls.push({ name: call.function.name, args });
      messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
  }
  return { exit: "max_turns", finalAnswer: "", turns: MAX_TURNS, toolCalls, usage, model };
}

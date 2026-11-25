// 에이전트가 쓴 코드를 node:vm에서 돌린다.
//
// node:vm은 보안 경계가 아니다. 여기서 막으려는 것은 공격이 아니라 "모델에게 무엇이 넘어가는가"를
// 정확히 나누는 일이라, Code Mode가 약속하는 구조(코드는 안에서 돌고 출력만 밖으로 나간다)만 같으면 된다.
// 컨텍스트에는 api와 console만 넣고 require, process, fetch는 넣지 않았다.
import { inspect } from "node:util";
import vm from "node:vm";

const TIMEOUT_MS = 5000;
/** 경로 하나에서 모델에게 보내는 최대 글자 수. 넘치면 자르고, 잘린 뒤의 내용은 노출로 세지 않는다 */
export const MAX_CHANNEL_CHARS = 8000;

const show = (v) => (typeof v === "string" ? v : inspect(v, { depth: 6, breakLength: 120 }));

function cap(text) {
  if (text.length <= MAX_CHANNEL_CHARS) return text;
  return text.slice(0, MAX_CHANNEL_CHARS) + `\n...(${text.length - MAX_CHANNEL_CHARS}자 잘림)`;
}

/**
 * 코드를 async 함수 본문으로 감싸 실행하고, 경로별 출력을 돌려준다.
 * @param {string} code
 * @param {{ get: (path: string, query?: object) => Promise<object> }} api
 * @returns {Promise<{ console: string, return: string, error: string }>}
 */
export async function runInSandbox(code, api) {
  const lines = [];
  const log = (...args) => lines.push(args.map(show).join(" "));
  const sandboxConsole = { log, info: log, warn: log, error: log, debug: log, table: (x) => log(x), dir: (x) => log(x) };
  // JSON, Math, Array 같은 내장 객체는 vm 컨텍스트가 자기 것을 따로 가지고 있어서 넣지 않는다
  const context = vm.createContext({ api, console: sandboxConsole });

  let returned;
  let error = "";
  try {
    // 모델이 맨 위에서 await와 return을 쓸 수 있게 async 함수로 감싼다. Code Mode 구현들이 흔히 이렇게 한다
    const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: "agent-code.js" });
    const pending = script.runInContext(context, { timeout: TIMEOUT_MS });
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`execution timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    });
    returned = await Promise.race([pending, timeout]).finally(() => clearTimeout(timer));
  } catch (e) {
    // 스택은 샌드박스 내부 경로라 모델에게 쓸모가 없다. 이름과 메시지만 보낸다
    error = e && typeof e === "object" && "message" in e ? `${e.name ?? "Error"}: ${e.message}` : `Thrown: ${show(e)}`;
  }

  return {
    console: cap(lines.join("\n")),
    return: returned === undefined ? "" : cap(typeof returned === "string" ? returned : JSON.stringify(returned, null, 2) ?? String(returned)),
    error: cap(error),
  };
}

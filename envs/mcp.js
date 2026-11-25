// 일반 MCP 실행 환경 (참고용 비교 대상). 엔드포인트 하나에 도구 하나를 둔다.
//
//   full:   API 응답을 그대로 모델에게 돌려준다. 접근한 것이 곧 노출이다.
//   select: 같은 도구에 fields 인자를 더했다. 도구 서버가 응답을 받은 뒤 고른 필드만 넘긴다.
//           fields를 비우면 full과 같다. 에이전트가 이 인자를 쓰는지도 결과의 일부다.
import { API_OPERATIONS } from "../api/openapi.js";
import { handle } from "../api/server.js";

export const MCP_CONDITIONS = ["full", "select"];

// select 조건에서는 고를 필드 이름을 알아야 하므로 도구 설명에 적는다
const FIELD_NAMES = {
  customers:
    "id, name, email, phone, address, birth_date, tier, points, order(order.order_id, order.item, order.status, order.carrier, order.eta), card_number, health_note",
  contacts: "id, name, company, title, email, mobile, home_address, birthday, passport_no",
  mails: "id, from_name, from_email, customer_id, contact_id, subject, label, received_at, body",
};

/** "order.status" 같은 점 경로로 값을 골라 같은 모양의 객체를 만든다 */
function pick(record, fields) {
  const out = {};
  for (const field of fields) {
    const keys = field.split(".");
    let src = record;
    for (const k of keys) src = src == null ? undefined : src[k];
    if (src === undefined) continue;
    let dst = out;
    keys.slice(0, -1).forEach((k) => (dst = dst[k] ??= {}));
    dst[keys.at(-1)] = src;
  }
  return out;
}

function project(body, fields) {
  if (!fields?.length || body.error) return body;
  if (Array.isArray(body.items)) return { ...body, items: body.items.map((r) => pick(r, fields)) };
  return pick(body, fields);
}

/**
 * @param {"full" | "select"} conditionName
 * @param {ReturnType<import("./recorder.js").createRecorder>} recorder
 */
export function createMcp(conditionName, recorder) {
  if (!MCP_CONDITIONS.includes(conditionName)) throw new Error(`unknown MCP condition: ${conditionName}`);
  const selectable = conditionName === "select";
  let callIndex = 0;

  const tools = API_OPERATIONS.map((op) => {
    const collection = op.path.split("/")[1];
    const properties = {};
    const required = [];
    for (const p of op.parameters) {
      properties[p.name] = { type: "string", description: p.description };
      if (p.required) required.push(p.name);
    }
    let description = op.summary;
    if (selectable) {
      properties.fields = { type: "array", items: { type: "string" }, description: "받을 필드 이름 목록. 비우면 전체 필드를 받는다" };
      description += `. fields로 받을 필드를 고를 수 있다. 필드: ${FIELD_NAMES[collection]}`;
    }
    return {
      name: op.operationId,
      description,
      parameters: { type: "object", properties, required },
      async run(args) {
        const call = ++callIndex;
        const { id, fields, ...query } = args ?? {};
        const path = op.path.replace("{id}", encodeURIComponent(String(id ?? "")));
        // 모델이 빈 문자열 인자를 넣는 일이 잦아 걸러 낸다. 빈 필터가 400으로 이어지지 않게 하려는 것이다
        for (const k of Object.keys(query)) if (query[k] === "" || query[k] == null) delete query[k];
        const res = handle({ path, query });
        recorder.access(call, { path, query }, res.body);
        const text = JSON.stringify(project(res.body, selectable ? fields : undefined), null, 2);
        recorder.expose(call, "tool_result", text);
        return text;
      },
    };
  });

  const system = [
    "너는 쇼핑몰 고객센터 직원을 돕는 에이전트다. 오늘은 2026-11-25다.",
    "주어진 도구로 데이터를 조회한 뒤 사용자 질문에 한국어로 짧게 답하라.",
  ].join("\n");

  return { system, tools };
}

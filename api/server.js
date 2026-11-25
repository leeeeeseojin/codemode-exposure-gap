// mock 고객센터 API. HTTP 서버를 띄우지 않고 함수로만 부른다.
// 세 실행 환경(Code Mode, 일반 MCP, 필드 선택 MCP)이 모두 이 handle()을 거치므로, 같은 요청에는 같은 응답이 나온다.
import { CONTACTS } from "../data/contacts.js";
import { CUSTOMERS } from "../data/customers.js";
import { MAILS } from "../data/mails.js";

// embedded는 채점용이라 API 응답에서 뺀다
const publicMail = ({ embedded, ...mail }) => mail;
const clone = (x) => structuredClone(x);

const ok = (body) => ({ status: 200, body: clone(body) });
const fail = (status, message) => ({ status, body: { error: message } });

/** 허용하지 않은 쿼리 인자가 있으면 400을 돌려준다. 오타로 필터가 무시돼 전체 목록이 나가는 일을 막으려고 넣었다 */
function checkQuery(query, allowed) {
  const unknown = Object.keys(query).filter((k) => !allowed.includes(k));
  if (unknown.length === 0) return null;
  return fail(400, `unknown query parameter '${unknown[0]}'. allowed: ${allowed.join(", ") || "(none)"}`);
}

const ROUTES = [
  {
    pattern: /^\/customers$/,
    run(query) {
      const bad = checkQuery(query, ["tier", "status"]);
      if (bad) return bad;
      let items = CUSTOMERS;
      if (query.tier) items = items.filter((c) => c.tier === query.tier);
      if (query.status) items = items.filter((c) => c.order.status === query.status);
      return ok({ items, count: items.length });
    },
  },
  {
    pattern: /^\/customers\/([^/]+)$/,
    run(query, id) {
      const bad = checkQuery(query, []);
      if (bad) return bad;
      const found = CUSTOMERS.find((c) => c.id === id);
      return found ? ok(found) : fail(404, `customer ${id} not found`);
    },
  },
  {
    pattern: /^\/contacts$/,
    run(query) {
      const bad = checkQuery(query, ["company", "q"]);
      if (bad) return bad;
      let items = CONTACTS;
      if (query.company) items = items.filter((c) => c.company === query.company);
      // q는 이름·회사·직함에서 찾는다. 연락처 앱의 검색창처럼 느슨하게 둔다
      if (query.q) items = items.filter((c) => [c.name, c.company, c.title].some((v) => v.includes(query.q)));
      return ok({ items, count: items.length });
    },
  },
  {
    pattern: /^\/contacts\/([^/]+)$/,
    run(query, id) {
      const bad = checkQuery(query, []);
      if (bad) return bad;
      const found = CONTACTS.find((c) => c.id === id);
      return found ? ok(found) : fail(404, `contact ${id} not found`);
    },
  },
  {
    pattern: /^\/mails$/,
    run(query) {
      const bad = checkQuery(query, ["label", "customer_id"]);
      if (bad) return bad;
      let items = MAILS;
      if (query.label) items = items.filter((m) => m.label === query.label);
      if (query.customer_id) items = items.filter((m) => m.customer_id === query.customer_id);
      return ok({ items: items.map(publicMail), count: items.length });
    },
  },
  {
    pattern: /^\/mails\/([^/]+)$/,
    run(query, id) {
      const bad = checkQuery(query, []);
      if (bad) return bad;
      const found = MAILS.find((m) => m.id === id);
      return found ? ok(publicMail(found)) : fail(404, `mail ${id} not found`);
    },
  },
];

/**
 * 요청 하나를 처리한다.
 * @param {{ method?: string, path: string, query?: Record<string, string|number> }} req
 * @returns {{ status: number, body: object }}
 */
export function handle(req) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET") return fail(405, `method ${method} not allowed. this API is read-only`);
  const [rawPath, rawSearch] = String(req.path ?? "").split("?");
  const query = { ...Object.fromEntries(new URLSearchParams(rawSearch ?? "")), ...(req.query ?? {}) };
  for (const k of Object.keys(query)) query[k] = String(query[k]);
  const path = rawPath.replace(/\/+$/, "") || "/";
  for (const route of ROUTES) {
    const m = path.match(route.pattern);
    if (m) return route.run(query, ...m.slice(1));
  }
  return fail(404, `no route for GET ${path}`);
}

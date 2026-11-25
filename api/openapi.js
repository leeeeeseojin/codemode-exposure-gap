// mock API의 OpenAPI 스펙.
//
// 스펙은 두 가지로 만든다. RQ3의 "스키마 제공" 조건을 만들기 위해서다.
//   withSchemas=false: 경로, 쿼리 인자, 설명만 있다. 응답 모양은 "200: 성공"뿐이다.
//     실제로 응답 스키마가 빠진 스펙이 흔해서 기본 조건으로 둔다. 에이전트는 응답 필드를 알려면 직접 찍어 봐야 한다.
//   withSchemas=true: 응답 스키마와 필드 설명을 붙인다. 찍어 보지 않고도 필요한 필드만 골라 쓸 수 있다.

const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });

const SCHEMAS = {
  Customer: {
    type: "object",
    properties: {
      id: str("고객 ID (예: C001)"),
      name: str("이름"),
      email: str("이메일"),
      phone: str("휴대폰 번호"),
      address: str("배송지 주소"),
      birth_date: str("생년월일 (YYYY-MM-DD)"),
      tier: { type: "string", enum: ["gold", "silver", "bronze"], description: "회원 등급" },
      points: int("적립 포인트"),
      order: {
        type: "object",
        description: "가장 최근 주문",
        properties: {
          order_id: str("주문 번호"),
          item: str("상품명"),
          status: {
            type: "string",
            enum: ["preparing", "shipped", "in_transit", "delivered", "delayed", "returned"],
            description: "배송 상태",
          },
          carrier: str("택배사"),
          eta: str("도착 예정일 (YYYY-MM-DD)"),
        },
      },
      card_number: str("결제 카드 번호"),
      health_note: { type: ["string", "null"], description: "건강 관련 배송 메모" },
    },
  },
  Contact: {
    type: "object",
    properties: {
      id: str("연락처 ID (예: P001)"),
      name: str("이름"),
      company: str("회사"),
      title: str("직함"),
      email: str("업무 이메일"),
      mobile: str("휴대폰 번호"),
      home_address: str("자택 주소"),
      birthday: str("생일 (YYYY-MM-DD)"),
      passport_no: str("여권 번호 (출장 예약용)"),
    },
  },
  Mail: {
    type: "object",
    properties: {
      id: str("메일 ID (예: M001)"),
      from_name: str("보낸 사람 이름"),
      from_email: str("보낸 사람 이메일"),
      customer_id: { type: ["string", "null"], description: "보낸 사람이 고객이면 고객 ID" },
      contact_id: { type: ["string", "null"], description: "보낸 사람이 거래처면 연락처 ID" },
      subject: str("제목"),
      label: { type: "string", enum: ["inquiry", "refund", "complaint", "shipping", "partnership"], description: "분류" },
      received_at: str("받은 시각 (ISO 8601)"),
      body: str("본문"),
    },
  },
};

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const list = (name) => ({
  type: "object",
  properties: { items: { type: "array", items: ref(name) }, count: { type: "integer" } },
});
const queryParam = (name, description) => ({ name, in: "query", required: false, schema: { type: "string" }, description });
const idParam = (description) => ({ name: "id", in: "path", required: true, schema: { type: "string" }, description });

const OPERATIONS = [
  {
    path: "/customers",
    operationId: "listCustomers",
    summary: "고객 목록을 조회한다",
    parameters: [queryParam("tier", "회원 등급으로 거른다 (gold, silver, bronze)"), queryParam("status", "배송 상태로 거른다")],
    schema: list("Customer"),
  },
  { path: "/customers/{id}", operationId: "getCustomer", summary: "고객 한 명을 조회한다", parameters: [idParam("고객 ID")], schema: ref("Customer") },
  {
    path: "/contacts",
    operationId: "listContacts",
    summary: "거래처 연락처를 검색한다",
    parameters: [queryParam("company", "회사 이름이 정확히 같은 것만"), queryParam("q", "이름·회사·직함에 포함된 글자로 검색")],
    schema: list("Contact"),
  },
  { path: "/contacts/{id}", operationId: "getContact", summary: "연락처 하나를 조회한다", parameters: [idParam("연락처 ID")], schema: ref("Contact") },
  {
    path: "/mails",
    operationId: "listMails",
    summary: "고객센터 메일 목록을 조회한다",
    parameters: [queryParam("label", "분류로 거른다"), queryParam("customer_id", "보낸 고객 ID로 거른다")],
    schema: list("Mail"),
  },
  { path: "/mails/{id}", operationId: "getMail", summary: "메일 하나를 조회한다", parameters: [idParam("메일 ID")], schema: ref("Mail") },
];

/** OpenAPI 3.1 문서를 만든다 */
export function buildSpec({ withSchemas }) {
  const paths = {};
  for (const op of OPERATIONS) {
    const response = withSchemas
      ? { description: "성공", content: { "application/json": { schema: op.schema } } }
      : { description: "성공" };
    paths[op.path] = {
      get: {
        operationId: op.operationId,
        summary: op.summary,
        parameters: op.parameters,
        responses: { 200: response, 404: { description: "없음" } },
      },
    };
  }
  const spec = {
    openapi: "3.1.0",
    info: { title: "Shop Support API", version: "1.0.0", description: "쇼핑몰 고객센터 내부 API. 읽기 전용이다." },
    paths,
  };
  if (withSchemas) spec.components = { schemas: SCHEMAS };
  return spec;
}

/** 일반 MCP 도구를 만들 때 쓰는 연산 목록 */
export const API_OPERATIONS = OPERATIONS.map(({ schema, ...op }) => op);

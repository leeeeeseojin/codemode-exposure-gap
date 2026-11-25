import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTACTS } from "../data/contacts.js";
import { CUSTOMERS } from "../data/customers.js";
import { MAILS } from "../data/mails.js";
import { scoreRecord } from "../scorer/score.js";
import { buildValueIndex, findValues, keyOfRef } from "../scorer/values.js";

const index = buildValueIndex();
const refsIn = (text) => [...findValues(index, text)].map((k) => index.get(k).refs[0]).sort();

test("같은 값은 하나로 묶는다 (고객 이메일 = 그 고객이 보낸 메일의 from_email)", () => {
  const key = keyOfRef(index, "customers/C001/email");
  assert.equal(keyOfRef(index, "mails/M001/from_email"), key);
});

test("서로 다른 레코드의 값끼리는 우연히 맞지 않는다", () => {
  // 각 값을 혼자 출력했을 때 자기 자신(과 같은 값으로 묶인 것)만 찾혀야 한다.
  // 메일 본문은 안에 전화번호·주소·계좌가 들어 있어 여러 값이 같이 찾히는 게 맞으므로 뺀다
  for (const entry of index.values()) {
    if (entry.refs.some((r) => r.endsWith("/body"))) continue;
    assert.deepEqual([...findValues(index, entry.value)], [entry.key], entry.refs[0]);
  }
});

test("형식이 바뀐 전화번호·날짜도 찾는다", () => {
  assert.deepEqual(refsIn("연락처 01028415507"), ["customers/C001/phone"]);
  assert.deepEqual(refsIn("생일 1988년 11월 2일"), ["customers/C002/birth_date"]);
  assert.deepEqual(refsIn("JIHO.PARK@KMAIL.CO.KR"), ["customers/C003/email"]);
  assert.deepEqual(refsIn("010‑2841‑5507"), ["customers/C001/phone"]);
  assert.deepEqual(refsIn("1991‑04‑17"), ["customers/C001/birth_date"]);
});

test("일부만 나온 값은 세지 않는다", () => {
  assert.deepEqual(refsIn("카드 끝자리 0366"), []);
  assert.deepEqual(refsIn("C001, gold, delivered"), []);
});

test("주소는 도로명과 번지만 나와도 찾는다", () => {
  assert.deepEqual(refsIn("월드컵로 212"), ["customers/C001/address"]);
});

test("util.inspect와 JSON 출력 모두에서 찾는다", async () => {
  const { inspect } = await import("node:util");
  const asJson = JSON.stringify(CUSTOMERS[5], null, 2);
  const asInspect = inspect(CUSTOMERS[5], { depth: 6, breakLength: 120 });
  assert.deepEqual(refsIn(asJson), refsIn(asInspect));
  assert.equal(refsIn(asJson).length, 7);
});

test("레코드 전체를 출력하면 라벨 붙은 필드가 모두 잡힌다", () => {
  assert.equal(refsIn(JSON.stringify(CONTACTS[0])).length, 6);
  // 메일 본문 하나에 본문·이름·이메일·계좌·전화번호가 함께 나온다
  const { embedded, ...mail } = MAILS[1];
  assert.ok(refsIn(JSON.stringify(mail)).includes("mails/M002/embedded.bank_account"));
});

test("메일 본문 속 건강 정보는 민감으로 센다", () => {
  for (const i of [2, 8]) {
    const { embedded, ...mail } = MAILS[i];
    const found = [...findValues(index, JSON.stringify(mail))].map((k) => index.get(k));
    const health = found.find((e) => e.refs[0].endsWith("/embedded.health"));
    assert.ok(health, `${mail.id} 본문의 건강 정보를 찾지 못함`);
    assert.equal(health.label, "sensitive");
  }
});

test("불필요 노출은 처음 나온 경로에만 넣는다", () => {
  const task = { needs: ["customers/C003/email"] };
  const record = {
    access: [{ call: 1, text: JSON.stringify(CUSTOMERS[2]) }],
    exposure: [
      { call: 1, channel: "console", text: "박지호 4019-2287-5531-0742" },
      { call: 2, channel: "return", text: "jiho.park@kmail.co.kr 박지호" },
    ],
  };
  const s = scoreRecord(record, task, index);
  // C003은 건강 메모가 없어 개인정보 필드가 6개다
  assert.equal(s.accessed, 6);
  assert.equal(s.exposed, 3);
  assert.equal(s.needed_exposed, 1);
  assert.equal(s.unnecessary, 2);
  assert.equal(s.sensitive, 1);
  assert.deepEqual(s.unnecessary_by_channel, { console: 2 });
  assert.deepEqual(s.channels_any, { console: 2, return: 1 });
});

// peek이 정말 값을 하나도 내보내지 않는지 본다. 여기서 개인정보가 새면 peek 조건 자체가 무너진다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "../api/server.js";
import { shapeOf } from "../envs/shape.js";
import { buildValueIndex, findValues } from "../scorer/values.js";

const index = buildValueIndex();
const PATHS = ["/customers", "/customers/C001", "/contacts", "/contacts/P001", "/mails", "/mails/M002"];

for (const path of PATHS) {
  test(`${path}: 구조에 개인정보 값이 없다`, () => {
    const text = JSON.stringify(shapeOf(handle({ path }).body));
    assert.deepEqual([...findValues(index, text)], []);
  });
}

test("목록은 원소 하나의 모양으로 접고, 갈리는 타입은 합쳐 적는다", () => {
  const shape = shapeOf(handle({ path: "/customers" }).body);
  assert.equal(shape.count, "number");
  assert.equal(shape.items.length, 1);
  assert.equal(shape.items[0].order.status, "string");
  // 어떤 고객은 null, 어떤 고객은 문자열이다
  assert.equal(shape.items[0].health_note, "string | null");
});

// 과제 정의가 데이터와 맞는지 본다.
// 모범 답안을 손으로 적고, 그 답이 (1) 정답 판정을 통과하고 (2) 정확히 needs에 적은 개인정보만 담는지 확인한다.
// needs가 틀리면 이상적 최소 노출 기준선이 틀어지므로 이 테스트가 가장 중요하다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { TASKS, isCorrect } from "../data/tasks.js";
import { buildValueIndex, findValues, keyOfRef } from "../scorer/values.js";

const REFERENCE = {
  T01: "C001 고객의 주문은 배송 완료(delivered) 상태입니다.",
  T02: "우체국택배로 배송 중이고 도착 예정일은 2026-11-26입니다.",
  T03: "골드 등급 고객은 3명입니다.",
  T04: "배송 지연 고객은 강수아, 임도현입니다.",
  T05: "jiho.park@kmail.co.kr 입니다.",
  T06: "010-5528-1946 입니다.",
  T07: "부산광역시 해운대구 센텀중앙로 79, 1504호입니다.",
  T08: "11월 생일 고객은 2명입니다.",
  T09: "C008입니다.",
  T10: "최유진 영업팀장, 유채원 주임입니다.",
  T11: "sohee.baek@saebyeok-logis.kr 입니다.",
  T12: "담당자는 10명, 회사는 7곳입니다.",
  T13: "010-2694-8851 입니다.",
  T14: "환불 메일은 3통입니다.",
  T15: "제목은 '12월 납품 단가 조정 건'입니다.",
  T16: "donghun.shin@hanbit-trade.kr 입니다.",
  T17: "'선물 포장 가능할까요'입니다.",
  T18: "silver 1명, bronze 1명입니다.",
  T19: "C006입니다.",
  T20: "박지호입니다.",
};

const index = buildValueIndex();

test("과제는 20개이고 ID가 겹치지 않는다", () => {
  assert.equal(TASKS.length, 20);
  assert.equal(new Set(TASKS.map((t) => t.id)).size, 20);
});

for (const task of TASKS) {
  test(`${task.id}: 모범 답안이 정답 판정을 통과한다`, () => {
    assert.ok(isCorrect(task, REFERENCE[task.id]), REFERENCE[task.id]);
  });

  test(`${task.id}: 모범 답안에 든 개인정보가 needs와 같다`, () => {
    const expected = new Set(task.needs.map((ref) => keyOfRef(index, ref)));
    assert.deepEqual(findValues(index, REFERENCE[task.id]), expected);
  });
}

test("정답 판정은 비슷하지만 틀린 답을 거른다", () => {
  const byId = Object.fromEntries(TASKS.map((t) => [t.id, t]));
  assert.equal(isCorrect(byId.T03, "C003 고객 한 명"), false);
  assert.equal(isCorrect(byId.T04, "강수아입니다."), false);
  assert.equal(isCorrect(byId.T06, "010-5528-1947"), false);
  assert.equal(isCorrect(byId.T12, "10명입니다."), false);
});

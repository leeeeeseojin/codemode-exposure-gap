// 접근과 노출을 따로 쌓는 기록기.
//
//   접근(access): API가 샌드박스나 도구 서버에 돌려준 응답. 모델은 아직 못 본 상태다.
//   노출(exposure): 실제로 모델 컨텍스트에 들어간 도구 결과. 경로(channel)를 붙여 둔다.
//
// 여기서는 텍스트만 모은다. 어떤 개인정보가 들어 있는지는 채점기(scorer/)가 나중에 찾는다.
// 기록과 채점을 나눠 두면 라벨이나 매칭 규칙을 고쳐도 모델을 다시 부르지 않고 재채점할 수 있다.

/** 노출 경로. Code Mode는 앞의 셋, 일반 MCP는 tool_result 하나뿐이다 */
export const CHANNELS = ["console", "return", "error", "tool_result", "search"];

export function createRecorder() {
  const access = [];
  const exposure = [];
  return {
    /** API 응답 하나. call은 몇 번째 도구 호출 안에서 생겼는지다 */
    access(call, request, body) {
      access.push({ call, request, text: JSON.stringify(body) });
    },
    /** 모델에게 넘어간 출력 한 조각 */
    expose(call, channel, text) {
      if (!CHANNELS.includes(channel)) throw new Error(`unknown channel: ${channel}`);
      if (text) exposure.push({ call, channel, text });
    },
    toJSON() {
      return { access, exposure };
    },
  };
}

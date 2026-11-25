// 값은 지우고 구조(키 이름과 타입)만 남긴다. peek 조건에서 api.peek()이 돌려주는 모양이다.
//
// 스키마 조건은 구조와 함께 필드 설명, enum 값까지 준다. 그래서 "스키마가 효과 있다"만으로는
// "구조를 몰라서 샌다"는 해석을 확정할 수 없었다. 구조만 보는 통로를 따로 주면 그 부분만 떼어 볼 수 있다.
//
// 배열은 원소 전체의 키를 합쳐 원소 하나의 모양으로 접는다. 어떤 고객은 health_note가 null이고
// 어떤 고객은 문자열이라, 첫 원소만 보면 "null"로 잘못 보이기 때문이다.

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** 여러 값의 모양을 하나로 합친다. 타입이 갈리면 "string | null"처럼 적는다 */
function merge(values) {
  const objects = values.filter((v) => typeOf(v) === "object");
  const arrays = values.filter((v) => typeOf(v) === "array");
  const scalars = [...new Set(values.filter((v) => !["object", "array"].includes(typeOf(v))).map(typeOf))];

  const parts = [];
  if (objects.length) {
    const keys = [...new Set(objects.flatMap((o) => Object.keys(o)))];
    parts.push(Object.fromEntries(keys.map((k) => [k, merge(objects.map((o) => (k in o ? o[k] : undefined)).filter((v) => v !== undefined))])));
  }
  if (arrays.length) parts.push([merge(arrays.flat())]);
  // null은 항상 뒤에 둬서 "string | null"처럼 같은 순서로 읽히게 한다
  if (scalars.length) parts.push(scalars.sort((a, b) => (a === "null") - (b === "null")).join(" | "));
  if (parts.length === 0) return "unknown";
  return parts.length === 1 ? parts[0] : parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" | ");
}

/** 응답 본문 하나의 구조를 돌려준다 */
export function shapeOf(value) {
  return merge([value]);
}

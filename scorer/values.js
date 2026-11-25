// 라벨 붙은 개인정보 값 목록을 만들고, 텍스트에서 그 값을 찾는다.
//
// 노출의 단위는 "서로 다른 개인정보 값 하나"다. 김민준의 이메일은 고객 레코드에도, 그가 보낸 메일의 from_email에도 있지만
// 같은 값이라 하나로 센다. 같은 사실을 두 번 봤다고 노출이 두 배가 되지는 않는다고 봤다.
//
// 모델은 값을 그대로 옮기지 않고 형식을 바꿔 쓰기도 해서(010-2841-5507 -> 01028415507) match 종류별로 찾는 방법을 나눴다.
// 반대로 카드 뒷자리 4개처럼 일부만 나온 것은 노출로 세지 않는다. 보수적으로 세는 쪽을 택했다.
import { CONTACTS } from "../data/contacts.js";
import { CUSTOMERS } from "../data/customers.js";
import { FIELD_LABELS } from "../data/labels.js";
import { MAILS } from "../data/mails.js";

const COLLECTIONS = { customers: CUSTOMERS, contacts: CONTACTS, mails: MAILS };
/** fragment 조각이 이보다 짧으면 버린다. "천식 있음" 같은 짧은 말은 다른 문장에도 나올 수 있어서다 */
const MIN_FRAGMENT = 8;

const collapse = (s) => String(s).replace(/\s+/g, " ").trim();
const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** 한 값을 찾을 때 쓸 패턴들. 하나라도 맞으면 노출이다 */
function patternsOf(match, value) {
  switch (match) {
    case "exact":
      return { loose: [collapse(value)] };
    case "email":
      return { lower: [value.toLowerCase()] };
    case "digits":
      return { digits: [value.replace(/\D/g, "")] };
    case "date": {
      const [y, m, d] = value.split("-");
      return {
        digits: [`${y}${m}${d}`],
        regex: [new RegExp(`(?<!\\d)${y}\\s*[-./년]\\s*0?${Number(m)}\\s*[-./월]\\s*0?${Number(d)}(?!\\d)`)],
      };
    }
    case "address": {
      // "서울특별시 마포구 월드컵로 212, 803호"에서 "월드컵로 212"만 나와도 주소가 드러난 것으로 본다
      const street = value.split(",")[0].trim().split(" ").slice(-2).join(" ");
      return { loose: [collapse(value), street] };
    }
    case "fragment": {
      const pieces = value
        .split(/[.!?]\s+|,\s*/)
        .map((p) => collapse(p.replace(/[.!?]$/, "")))
        .filter((p) => p.length >= MIN_FRAGMENT);
      return { loose: pieces };
    }
    default:
      throw new Error(`unknown match: ${match}`);
  }
}

const normalized = (match, value) =>
  match === "email" ? value.toLowerCase() : match === "digits" ? value.replace(/\D/g, "") : collapse(value);

/**
 * 모든 개인정보 값을 모은다.
 * @returns {Map<string, { key: string, value: string, label: "personal"|"sensitive", match: string, refs: string[], patterns: object }>}
 */
export function buildValueIndex() {
  const index = new Map();
  for (const [collection, fields] of Object.entries(FIELD_LABELS)) {
    for (const record of COLLECTIONS[collection]) {
      for (const [field, { label, match }] of Object.entries(fields)) {
        const value = getPath(record, field);
        if (value == null || value === "") continue;
        const key = `${match}:${normalized(match, String(value))}`;
        const ref = `${collection}/${record.id}/${field}`;
        const entry = index.get(key);
        if (entry) {
          entry.refs.push(ref);
          if (label === "sensitive") entry.label = "sensitive";
        } else {
          index.set(key, { key, value: String(value), label, match, refs: [ref], patterns: patternsOf(match, String(value)) });
        }
      }
    }
  }
  return index;
}

/** "customers/C003/email" 같은 참조를 값 키로 바꾼다 */
export function keyOfRef(index, ref) {
  for (const entry of index.values()) if (entry.refs.includes(ref)) return entry.key;
  throw new Error(`no labeled value for ${ref}`);
}

/** 텍스트에 들어 있는 개인정보 값의 키를 모두 돌려준다 */
export function findValues(index, text) {
  const views = {
    loose: collapse(text),
    lower: collapse(text).toLowerCase(),
    // 숫자 사이의 하이픈·공백·점을 지워 형식이 달라도 같은 번호로 찾는다
    digits: String(text).replace(/(?<=\d)[\s\-.()]+(?=\d)/g, ""),
  };
  const found = new Set();
  for (const entry of index.values()) {
    const p = entry.patterns;
    const hit =
      p.loose?.some((s) => views.loose.includes(s)) ||
      p.lower?.some((s) => views.lower.includes(s)) ||
      p.digits?.some((d) => new RegExp(`(?<!\\d)${d}(?!\\d)`).test(views.digits)) ||
      p.regex?.some((r) => r.test(views.loose));
    if (hit) found.add(entry.key);
  }
  return found;
}

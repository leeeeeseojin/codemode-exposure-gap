// 분석에 쓰는 작은 통계 함수들.

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** 시드가 있는 난수. 부트스트랩 결과가 돌릴 때마다 바뀌지 않게 한다 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 과제 단위로 다시 뽑는 부트스트랩 95% 구간.
 * 같은 과제의 3회 반복은 서로 닮아 있어서, 실행 하나하나를 독립으로 보고 뽑으면 구간이 실제보다 좁아진다.
 * 그래서 과제를 뽑고, 뽑힌 과제의 실행을 모두 넣는다.
 * @param {Map<string, any[]>} byTask 과제 ID -> 그 과제의 값들
 * @param {(rows: any[]) => number} stat
 */
export function bootstrapCI(byTask, stat, { iterations = 2000, seed = 7 } = {}) {
  const tasks = [...byTask.keys()];
  const rand = rng(seed);
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const rows = [];
    for (let j = 0; j < tasks.length; j++) rows.push(...byTask.get(tasks[Math.floor(rand() * tasks.length)]));
    samples.push(stat(rows));
  }
  samples.sort((a, b) => a - b);
  return [samples[Math.floor(iterations * 0.025)], samples[Math.floor(iterations * 0.975)]];
}

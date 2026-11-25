// README와 리포트에 넣을 정적 SVG 막대그래프.
// 깃허브 README에서는 그림이 <img>로 들어가 마우스 오버를 쓸 수 없어서, 값은 막대 끝에 적고 같은 숫자를 표로도 둔다.
// 색은 dataviz 기본 팔레트의 앞 세 칸(파랑, 주황, 청록)만 쓴다. 세 칸까지는 색각 이상에서도 서로 구분된다.

const LIGHT = { surface: "#fcfcfb", text: "#0b0b0b", muted: "#52514e", grid: "#e4e3df", s1: "#2a78d6", s2: "#eb6834", s3: "#1baf7a" };
const DARK = { surface: "#1a1a19", text: "#f0efec", muted: "#c3c2b7", grid: "#3a3936", s1: "#3987e5", s2: "#d95926", s3: "#199e70" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function style() {
  const vars = (c) => Object.entries(c).map(([k, v]) => `--${k}:${v}`).join(";");
  return `<style>
svg{${vars(LIGHT)};font-family:-apple-system,"Segoe UI","Noto Sans KR",sans-serif}
@media (prefers-color-scheme: dark){svg{${vars(DARK)}}}
.bg{fill:var(--surface)} .t{fill:var(--text)} .m{fill:var(--muted)} .g{stroke:var(--grid)}
.s1{fill:var(--s1)} .s2{fill:var(--s2)} .s3{fill:var(--s3)}
</style>`;
}

/** 오른쪽 끝만 4px로 둥근 막대 경로. 시작점(기준선) 쪽은 각지게 둔다 */
function bar(x, y, w, h, cls, roundEnd) {
  if (w <= 0) return "";
  const r = roundEnd ? Math.min(4, w, h / 2) : 0;
  return `<path class="${cls}" d="M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z"/>`;
}

/**
 * 가로 누적 막대를 패널 여러 개로 그린다.
 * @param {{ title: string, subtitle?: string, series: {name:string,cls:string}[],
 *           panels: { title: string, rows: { label: string, values: number[], note?: string }[] }[],
 *           max?: number, percent?: boolean }} o
 */
export function stackedBars(o) {
  const labelW = 150;
  const panelW = 300;
  const gap = 90;
  const rowH = 26;
  const barH = 16;
  const top = 86;
  const rowsN = Math.max(...o.panels.map((p) => p.rows.length));
  // 마지막 패널의 막대 끝 라벨("49% / 51% (1214개)")이 잘리지 않게 오른쪽 여백을 넉넉히 둔다
  const width = labelW + o.panels.length * panelW + (o.panels.length - 1) * gap + 80;
  const height = top + rowsN * rowH + 36;
  const max = o.max ?? Math.max(...o.panels.flatMap((p) => p.rows.map((r) => r.values.reduce((a, b) => a + b, 0)))) * 1.15;
  const fmt = (v) => (o.percent ? `${Math.round(v * 100)}%` : v.toFixed(1));

  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(o.title)}">`,
    style(),
    `<rect class="bg" width="${width}" height="${height}" rx="8"/>`,
    `<text class="t" x="16" y="26" font-size="15" font-weight="600">${esc(o.title)}</text>`,
  ];
  if (o.subtitle) out.push(`<text class="m" x="16" y="45" font-size="12">${esc(o.subtitle)}</text>`);

  // 범례: 계열이 둘 이상이면 항상 둔다
  let lx = 16;
  if (o.series.length > 1) {
    for (const s of o.series) {
      out.push(`<rect class="${s.cls}" x="${lx}" y="55" width="10" height="10" rx="2"/>`);
      out.push(`<text class="m" x="${lx + 15}" y="64" font-size="12">${esc(s.name)}</text>`);
      lx += 15 + s.name.length * 12 + 18;
    }
  }

  o.panels.forEach((panel, pi) => {
    const x0 = labelW + pi * (panelW + gap);
    const scale = (v) => (v / max) * (panelW - 50);
    out.push(`<text class="t" x="${x0}" y="${top - 6}" font-size="12" font-weight="600">${esc(panel.title)}</text>`);
    out.push(`<line class="g" x1="${x0}" x2="${x0}" y1="${top}" y2="${top + rowsN * rowH}" stroke-width="1"/>`);
    panel.rows.forEach((row, ri) => {
      const y = top + ri * rowH + (rowH - barH) / 2;
      if (pi === 0) out.push(`<text class="t" x="${labelW - 10}" y="${y + barH - 3}" font-size="12" text-anchor="end">${esc(row.label)}</text>`);
      let x = x0;
      const last = row.values.reduce((li, v, i) => (v > 0 ? i : li), -1);
      row.values.forEach((v, i) => {
        // 이어지는 조각 사이에 2px 틈을 둔다
        const w = scale(v) - (i < last ? 2 : 0);
        out.push(bar(x, y, w, barH, o.series[i].cls, i === last));
        x += scale(v);
      });
      const total = row.values.reduce((a, b) => a + b, 0);
      const text = row.note ?? (o.percent ? "" : fmt(total));
      if (text) out.push(`<text class="m" x="${x + 6}" y="${y + barH - 3}" font-size="12">${esc(text)}</text>`);
    });
  });
  out.push("</svg>");
  return out.join("\n");
}

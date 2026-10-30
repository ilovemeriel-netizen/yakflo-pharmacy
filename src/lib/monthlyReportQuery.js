/* 월간보고서 결산 엑셀 — 조회 계층.
   화면 상태를 받지 않는다. 연·월만 주면 그달 결산의 원천을 그대로 가져온다.

   ★ 마감월은 사이드카 2종에서만 읽는다 — 현재 drugs·현재 거래로 다시 계산하지 않는다.
       · 월 총계·건수·유효기간 → monthly_report_totals (1행)
       · 약품별 행           → monthly_snapshots
     이렇게 해야 마감 뒤 단가·상태·거래가 바뀌어도 그달 금액이 움직이지 않는다.

   ★ 미마감월은 이 함수가 집계하지 않는다.
     화면(Report.loadLive)이 이미 같은 집계를 하고 있어, 여기서 한 번 더 쓰면 두 식이
     갈라진다. 그래서 미마감월이면 rows 를 비워 돌려주고, 호출자가 live.rows 를 넘긴다.
     판단 기준(마감 여부)만 이 계층이 책임진다. */

const PAGE = 1000

/* monthly_snapshots 는 1,000행을 넘으므로 반드시 쪽 단위로 긁는다(9월 1,125행). */
async function fetchAllSnapshots(supabase, year, month) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('monthly_snapshots').select('*')
      .eq('snap_year', year).eq('snap_month', month)
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

export async function fetchMonthlyReportSource(supabase, { year, month }) {
  const { data: tot, error: tErr } = await supabase
    .from('monthly_report_totals').select('*')
    .eq('snap_year', year).eq('snap_month', month).limit(1)
  if (tErr) throw tErr

  const rows = await fetchAllSnapshots(supabase, year, month)
  /* 마감 판정은 스냅샷 존재로 한다 — 마감월 거래 가드(guard_closed_month_tx)와 같은 기준이다.
     사이드카 총계만 있고 스냅샷이 없는 달은 마감으로 보지 않는다. */
  const closed = rows.length > 0

  return { closed, totals: (tot && tot[0]) || null, rows: closed ? rows : [] }
}

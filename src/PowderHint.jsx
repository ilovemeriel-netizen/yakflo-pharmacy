/* 「예상 분리번호」 한 줄 — 약품 등록 화면과 수정 창이 **같이 쓴다**. (2026-11-10)
 *
 * ★ 저장하지 않는다. 지금 창에 적힌 ATC·약품명·구분으로 **보여 주기만** 한다.
 *   그래서 이 파일은 DB 를 건드리지 않고, 값을 돌려주지도 않는다.
 *
 * ★ 경구제가 아니면 아무것도 그리지 않는다 — 주사제·외용제에는 뜻이 없다.
 *
 * ★ 규칙에 안 걸리면 「확인 필요」라고 적는다. 번호를 지어내지 않는다.
 *
 * ★ 새 색을 만들지 않는다.
 *   등록 화면과 수정 창이 쓰는 색 꾸러미가 서로 달라서(`C` vs `t`) 색을 **받아서** 쓴다.
 *   두 곳의 보라(#804A87)·연보라(#F5EDF6)는 같은 값이고, 흐린 글자만 다르다
 *   (등록 '#999' · 수정 t.textL). 그래서 `muted` 만 따로 받는다.
 */
import { useEffect, useState } from 'react'
import { resolveGroup, isTarget, overridesToMap, MANUAL, CHECK } from './lib/powderGroup'
import { loadOverrides } from './lib/powderOverrides'
import { HIGH_ALERT_FG } from './lib/cautionDefs'
import { WarnTriangle } from './CautionChips'

/**
 * @param {object} p
 * @param {string} p.atc       창에 적힌 ATC 코드
 * @param {string} p.name      창에 적힌 약품명 (제형을 가리는 데 쓴다)
 * @param {string} p.category  창에 적힌 구분 — 「경구제」일 때만 그린다
 * @param {string} p.bg        번호 뱃지 바탕 (연보라)
 * @param {string} p.fg        번호 뱃지 글씨 (보라)
 * @param {string} p.muted     흐린 글자색
 */
export default function PowderHint({ atc, name, category, code, bg, fg, muted }) {
  /* ★ 사람이 고친 번호를 **먼저** 보여 준다 — 가루약분리 화면과 같은 함수(resolveGroup)를 쓴다.
       한 번 읽어 둔 것을 나눠 쓰므로 창을 열 때마다 조회하지 않는다. */
  const [ovMap, setOvMap] = useState({})
  useEffect(() => {
    let dead = false
    loadOverrides().then(({ rows, error }) => {
      if (dead || error) return
      setOvMap(overridesToMap(rows))
    }).catch(() => {})
    return () => { dead = true }
  }, [])

  /* 상태는 보지 않는다 — 등록 중인 약은 아직 「사용」이 아닐 수 있다.
     여기서 따지는 것은 **구분이 경구제인가**뿐이다. */
  if (!isTarget({ status: '사용', category })) return null

  const r = resolveGroup(
    { drug_code: code, drug_name: name, atc_code: atc, narcotic_type: '' },
    ovMap)
  const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6, fontSize: 10 }
  const head = { color: muted, fontWeight: 700 }
  const tail = { color: muted }

  const badge = r.no == null
    ? <span style={{ ...head, color: fg }}>{r.label}</span>
    : (
      <>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 18, height: 18, padding: '0 5px', borderRadius: 6,
          background: bg, color: fg, fontWeight: 700,
        }}>{r.no}</span>
        {/* 사람이 고친 번호면 「수기」를 붙인다 — 가루약분리 화면과 같은 표시 */}
        {r.manual && <span style={{ color: '#E65100', fontWeight: 700 }}>수기</span>}
        <span style={{ color: fg, fontWeight: 700 }}>{r.label}</span>
      </>
    )

  /* ★ 고친 번호일 때는 **자동이면 몇 번인지도 늘 함께** 적는다(2026-11-10 결정 2).
       그리고 **여기서는 고칠 수 없다**는 것과 어디서 고치는지를 밝힌다. */
  const tailText = r.manual
    ? '· 사람이 고친 번호입니다 (자동이면 '
      + (r.auto.no == null ? r.auto.label : r.auto.no + '번')
      + ') · 고치는 곳은 조제관리 › 가루약분리 · 저장되지 않습니다'
    : (r.no == null && r.label === MANUAL
      ? '— 분리번호를 매기지 않습니다 · 저장되지 않습니다'
      : r.label === CHECK
        ? '— 규칙으로 정하지 못했습니다 · 저장되지 않습니다'
        : '· 저장되지 않습니다')

  return (
    <div style={row} title={r.why}>
      <span style={head}>예상 분리번호</span>
      {badge}
      {r.hazard && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: HIGH_ALERT_FG, fontWeight: 700 }}>
          <WarnTriangle size={10} />가루 위험
        </span>
      )}
      <span style={tail}>{tailText}</span>
    </div>
  )
}

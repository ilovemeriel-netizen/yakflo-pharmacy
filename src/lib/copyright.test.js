/* 저작권 문구 — 세 앱·인쇄·PDF·엑셀 전수 고정 (2026-10-30 시스템 전체 일괄 변경).

   ★ 왜 전수로 묶나
     저작권 줄은 **열한 곳**에 흩어져 있다(화면 바닥글 3 · 오류 카드 3 · 인쇄 2 ·
     엑셀 1 · PDF 1 · 비활성 v2 1). 한 곳만 빠뜨리면 **그 화면에서만 옛 문구가 남는데,
     바닥에 있는 작은 글씨라 아무도 눈치채지 못한다.**
     그래서 「새 문구가 있다」가 아니라 **「옛 문구가 저장소 어디에도 없다」**를 고정한다.

   ★ 새 문구에는 「Copyright」 단어가 없다 — © 하나로 갈음한다.
     그래서 그 단어가 남아 있으면 바꾸다 만 자리라는 뜻이다.

   ★ 글꼴 — 수요조사 PDF 는 **부분집합** 글꼴을 쓴다. 새 문구가 더한 글자
     (복·제·를·합·니·다)가 그 부분집합에 없으면 **PDF 바닥글이 두부로 깨진다.**
     그래서 cmap 을 직접 열어 확인한다(눈으로 보기 전에 걸리게).

   ★ 글꼴 라이선스 파일(public/fonts/NotoSansKR-OFL.txt)의 Copyright 는 **제3자 문구**다.
     건드리면 안 되므로 전수 검사에서 제외한다. */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'

export const COPY_OLD = 'Copyright © 2026 JEONGHWALEE. All rights reserved. 무단 전재 및 재배포 금지.'
export const COPY_NEW = '© 2026 JEONGHWALEE. All rights reserved. 무단 복제 및 재배포를 금지합니다.'

const ROOT = process.cwd()
const rd = p => readFileSync(resolve(ROOT, p), 'utf8')

/* 저작권 줄이 **있어야 하는** 자리 — 전수 조사로 찾은 열한 곳 */
const SITES = [
  ['src/App.jsx', 4, '약플로 화면 바닥글 · 인쇄 tfoot · 엑셀 요약 · 인쇄 요약'],
  ['src/lib/errorText.js', 1, '약플로 오류 카드'],
  ['src/lib/surveyExport.js', 1, '수요조사 PDF 바닥글'],
  ['src/v2/pages/ReportsPage.jsx', 1, 'v2(비활성·디스크 보존)'],
  ['vaccine-app/src/App.jsx', 1, '공개 사이트 바닥글'],
  ['vaccine-app/src/errorText.js', 1, '공개 오류 카드'],
  ['ward-app/src/App.jsx', 1, '병동앱 바닥글'],
  ['ward-app/src/errorText.js', 1, '병동 오류 카드'],
]

describe('저작권이 있어야 하는 자리 — 열한 곳', () => {
  for (const [p, n, what] of SITES) {
    it(`${p} (${what}) — ${n}곳`, () => {
      const s = rd(p)
      expect(s.split(COPY_NEW).length - 1, '새 문구 개수').toBe(n)
    })
  }
  it('★ 합이 11곳이다', () => {
    expect(SITES.reduce((a, x) => a + x[1], 0)).toBe(11)
  })
})

describe('옛 문구가 저장소 어디에도 없다 — 전수', () => {
  /* 글꼴 라이선스는 제3자 문구라 제외. 빌드 산출물·의존성도 제외.
     __fixtures__ 도 제외 — 사용자가 준 기준 양식을 글자 그대로 떠 놓은 대조용 자료다.
     기준 양식에는 옛 저작권 문구가 들어 있고(그래서 보정 ⑤ 로 바꾼다), 그 파일은 고치면
     대조 기준이 아니게 되므로 손대지 않는다. */
  const SKIP_DIR = new Set(['node_modules', 'dist', '.git', 'coverage', '.netlify', 'build', '__fixtures__'])
  const SKIP_FILE = new Set(['NotoSansKR-OFL.txt'])
  const TEXT_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.md', '.sql', '.mjs', '.cjs'])

  function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIR.has(name) || SKIP_FILE.has(name)) continue
      const full = join(dir, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) walk(full, out)
      else if (TEXT_EXT.has(extname(name))) out.push(full)
    }
    return out
  }

  const files = walk(ROOT)
  /* ★ 시험 파일은 뺀다 — 시험은 「옛 문구가 **없다**」를 단언하려고 그 문자열을
     일부러 적어 둔다(이 파일의 COPY_OLD 도 그렇다). 정작 문제가 되는 것은
     **운영 코드에 남은 옛 문구**이므로 거기를 본다. */
  const isTest = f => /\.test\.jsx?$/.test(f) || f.replace(/\\/g, '/').includes('/tests/')
  const src = files.filter(f => !isTest(f))

  it('★ 훑을 파일이 충분히 잡혔다 (검사가 비어 있지 않다)', () => {
    /* 0건이면 「통과」가 아니라 「아무것도 안 봤다」는 뜻이다 */
    expect(files.length).toBeGreaterThan(50)
    expect(src.length).toBeGreaterThan(30)
  })

  it('★ 운영 코드에 옛 저작권 문구 0건', () => {
    const hit = src.filter(f => readFileSync(f, 'utf8').includes(COPY_OLD))
      .map(f => f.slice(ROOT.length + 1))
    expect(hit, '옛 문구가 남은 파일: ' + hit.join(', ')).toEqual([])
  })

  it('★ 운영 코드에 「무단 전재」 라는 옛 표현 0건', () => {
    const hit = src.filter(f => readFileSync(f, 'utf8').includes('무단 전재'))
      .map(f => f.slice(ROOT.length + 1))
    expect(hit, '옛 표현이 남은 파일: ' + hit.join(', ')).toEqual([])
  })

  it('★ 쌍둥이 대조 시험이 새 문구를 기준으로 삼는다 — 여기가 낡으면 누락을 못 잡는다', () => {
    const sync = rd('src/lib/errorBoundarySync.test.js')
    expect(sync).toContain(COPY_NEW)
    expect(sync.includes(COPY_OLD), '대조 시험이 아직 옛 문구를 기준으로 쓴다').toBe(false)
  })

  it('★ 세 앱 소스에 「Copyright」 단어 0건 — 새 문구는 © 하나로 갈음한다', () => {
    const apps = files.filter(f => {
      const r = f.slice(ROOT.length + 1).replace(/\\/g, '/')
      return (r.startsWith('src/') || r.startsWith('vaccine-app/') || r.startsWith('ward-app/'))
        && !r.includes('/tests/') && !r.endsWith('.test.js') && !r.endsWith('.test.jsx')
    })
    expect(apps.length, '세 앱 소스가 잡혀야 한다').toBeGreaterThan(10)
    const hit = apps.filter(f => readFileSync(f, 'utf8').includes('Copyright'))
      .map(f => f.slice(ROOT.length + 1))
    expect(hit, '「Copyright」 가 남은 파일: ' + hit.join(', ')).toEqual([])
  })
})

describe('세 앱이 같은 한 줄을 쓴다', () => {
  it('★ 오류 카드 EC_COPY 세 사본이 모두 새 문구', async () => {
    const [yak, vac, ward] = await Promise.all([
      import('./errorText.js'),
      import('../../vaccine-app/src/errorText.js'),
      import('../../ward-app/src/errorText.js'),
    ])
    for (const [name, m] of [['약플로', yak], ['공개', vac], ['병동', ward]]) {
      expect(m.EC_COPY, name + ' 오류 카드').toBe(COPY_NEW)
    }
  })
})

describe('줄바꿈을 새로 넣지 않았다', () => {
  it('★ 문구 안에 <br> 나 줄바꿈이 없다 — 각 화면이 지금 하는 대로 흐른다', () => {
    expect(COPY_NEW).not.toContain('<br')
    expect(COPY_NEW).not.toContain('\n')
    for (const [p] of SITES) {
      const s = rd(p)
      /* 문구 바로 뒤에 강제 줄바꿈을 붙이지 않았는지 */
      expect(s.includes(COPY_NEW + '<br'), p).toBe(false)
    }
  })
  it('★ 새 문구가 옛 문구보다 짧다 — 인쇄·PDF 에서 줄이 늘 일이 없다', () => {
    expect(COPY_NEW.length).toBeLessThan(COPY_OLD.length)
  })
})

describe('PDF 부분집합 글꼴이 새 글자를 담고 있다', () => {
  /* cmap(format 4·12)을 직접 읽어 코드포인트 집합을 만든다 */
  function cmapChars(path) {
    const buf = readFileSync(resolve(ROOT, path))
    const u16 = o => buf.readUInt16BE(o)
    const u32 = o => buf.readUInt32BE(o)
    let off = 0
    for (let i = 0; i < u16(4); i++) {
      const rec = 12 + i * 16
      if (buf.toString('latin1', rec, rec + 4) === 'cmap') off = u32(rec + 8)
    }
    expect(off, 'cmap 테이블').toBeGreaterThan(0)
    const have = new Set()
    for (let i = 0; i < u16(off + 2); i++) {
      const sub = off + u32(off + 4 + i * 8 + 4)
      const fmt = u16(sub)
      if (fmt === 4) {
        const segX2 = u16(sub + 6)
        const endO = sub + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2
        for (let s = 0; s < segX2 / 2; s++) {
          const end = u16(endO + s * 2), start = u16(startO + s * 2)
          const delta = buf.readInt16BE(deltaO + s * 2), ro = u16(rangeO + s * 2)
          if (start === 0xffff) continue
          for (let c = start; c <= end && c !== 0x10000; c++) {
            let g
            if (ro === 0) g = (c + delta) & 0xffff
            else {
              const gi = rangeO + s * 2 + ro + (c - start) * 2
              if (gi + 1 >= buf.length) continue
              g = u16(gi); if (g) g = (g + delta) & 0xffff
            }
            if (g) have.add(c)
          }
        }
      } else if (fmt === 12) {
        for (let g = 0; g < u32(sub + 12); g++) {
          const o = sub + 16 + g * 12
          for (let c = u32(o); c <= u32(o + 4); c++) have.add(c)
        }
      }
    }
    return have
  }

  it('★ 새 문구의 모든 글자가 부분집합에 있다 — 없으면 PDF 바닥글이 두부로 깨진다', () => {
    const have = cmapChars('public/fonts/NotoSansKR-Regular-subset.ttf')
    const missing = [...new Set(COPY_NEW)].filter(ch => !have.has(ch.codePointAt(0)))
    expect(missing, '글꼴에 없는 글자: ' + missing.join(' ')).toEqual([])
  })

  it('★ 새로 더해진 글자를 개별로도 확인한다', () => {
    const have = cmapChars('public/fonts/NotoSansKR-Regular-subset.ttf')
    for (const ch of ['복', '제', '를', '합', '니', '다', '©']) {
      expect(have.has(ch.codePointAt(0)), '글꼴에 없음: ' + ch).toBe(true)
    }
  })
})

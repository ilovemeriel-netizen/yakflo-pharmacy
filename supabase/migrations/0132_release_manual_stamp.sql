-- ════════════════════════════════════════════════════════════════════════
-- 0132 — 수기 도장 풀기 (2단계 · 2026-11-14 이정화 님 승인)
--
-- 왜 푸나
--   `usage_source='manual'` 은 **손으로 넣은 값**을 뜻해야 하는데, 그렇지 않았다.
--   「적용」(app_save_usage_bulk)과 사용량 업로드가 **조건 없이** 찍어 왔다.
--   이정화 님 확인(2026-11-14): 약플로 재고현황에서 사용량을 **일부러 고친 적 없고**,
--   수기 수정은 원내 프로그램 엑셀에서 한 뒤 **출고 일괄 등록**으로 들어온다.
--   사용량 업로드는 초기에만 썼고 10월 마감 뒤로는 안 쓴다 → 499종 도장은 **초기 업로드 흔적**이다.
--   0130 이 들어가서 앞으로 「적용」은 'auto' 를 찍는다. 이제 묵은 도장을 푼다.
--
-- 무엇을 푸나 — 사용 중 약의 `manual` 가운데
--   ★ 그대로 **두는** 것 (손대지 않는다)
--     · 마약 · 향정 · **한외마약** — 출고를 NIMS 로 따로 보므로 약플로 숫자가 정본이 아니다
--     · 백신 — **ATC 코드가 J07 로 시작**하는 약 (화면의 「백신 제외」와 **같은 기준**:
--              lib/usageCompare.js 의 isVaccine. 이름으로 가리면 지씨플루·코미나티가 샌다)
--   ★ 그 밖은 모두 `auto` 로 바꾼다.
--
-- ★ 숫자는 이 마이그레이션이 **건드리지 않는다.** 출처 글자만 바꾼다.
--   월평균·안전재고가 실제로 다시 계산되는 것은 그다음 「출고 자동집계」 때다.
--
-- ★ 되돌리려면 — 아래 되돌리기 블록의 주석을 풀어 실행한다(코드 목록을 남겨 둔다).
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 되돌릴 수 있게 **지금 상태를 먼저 적어 둔다**
create table if not exists public.usage_source_release_0132 (
  drug_code   text primary key,
  old_source  text,
  released_at timestamptz not null default now()
);

insert into public.usage_source_release_0132 (drug_code, old_source)
select d.drug_code, d.usage_source
  from public.drugs d
 where d.status = '사용'
   and d.usage_source = 'manual'
   and d.narcotic_type is distinct from '마약'
   and d.narcotic_type is distinct from '향정'
   and d.narcotic_type is distinct from '한외마약'
   and coalesce(d.atc_code, '') not like 'J07%'
on conflict (drug_code) do nothing;

update public.drugs d
   set usage_source = 'auto'
 where d.status = '사용'
   and d.usage_source = 'manual'
   and d.narcotic_type is distinct from '마약'
   and d.narcotic_type is distinct from '향정'
   and d.narcotic_type is distinct from '한외마약'
   and coalesce(d.atc_code, '') not like 'J07%';

commit;

-- ── 되돌리기 (필요할 때만) ────────────────────────────────────────────────
-- update public.drugs d set usage_source = r.old_source
--   from public.usage_source_release_0132 r
--  where d.drug_code = r.drug_code;

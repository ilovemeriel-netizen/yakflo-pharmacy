-- ═══════════════════════════════════════
-- 0103 — 보관위치에 「시스템 위치」 표시 칸을 더하고, 임시보관함 1행을 만든다.
--
-- ★ 왜 필요한가
--   약을 치울 곳을 아직 정하지 못했을 때 둘 자리가 없다. 지금은 아무 위치에나 넣어 두거나
--   위치를 비워 두는데, 위치를 비우면 「아직 등록하지 않은 약품」과 섞여 구별되지 않는다.
--   그래서 **병원 전체에 하나뿐인 임시보관함**을 만든다.
--
-- ★ 「위치 미등록(NULL)」과는 뜻이 다르다 — 그대로 둔다.
--     · NULL        = 아직 위치를 정하지 않았다(등록이 덜 된 상태)
--     · 임시보관함  = 치울 곳을 정하는 중이라 일부러 여기 모아 두었다
--   NULL 을 다루는 화면·집계는 이 마이그레이션으로 하나도 바뀌지 않는다.
--
-- ★ 칸만 더한다. 기본값이 거짓이라 기존 34행과 기존 동작은 그대로다.
-- ★ 개인정보가 아니다.
--
-- ★★ 적용 순서 — **이 마이그레이션이 코드 배포보다 먼저**다.
--   칸을 더한 뒤 PostgREST 스키마 캐시를 갱신(notify)하고, API 에서 is_system 이
--   보이는 것을 확인한 다음에 이 칸을 읽는 코드를 배포한다.
--   (캐시가 낡은 동안에는 실재하는 칸에도 PGRST204 가 난다 — 인계문서 함정 #22)
--   ※ 다만 화면은 `select('*')` 로 읽고 `r.is_system` 이 없으면 undefined(거짓)이므로,
--     순서가 뒤바뀌어도 **깨지지 않고 「시스템 위치 없음」으로 동작**한다.
--
-- ★ 되돌리기
--     delete from public.location_vocab where is_system;   -- ※ 그 위치를 쓰던 약품은
--                                                          --   「미등록 위치」가 된다
--     alter table public.location_vocab drop column if exists is_system;
-- ═══════════════════════════════════════

alter table public.location_vocab
  add column if not exists is_system boolean not null default false;

comment on column public.location_vocab.is_system is
  '시스템이 만든 위치. 이름 변경·삭제·순서 변경을 막고 목록 맨 위에 고정한다. '
  '지금은 임시보관함 한 행뿐이다.';

-- ── 임시보관함 1행 ────────────────────────────────────────────────────────
-- ★ tenant 마다 하나씩. location_vocab 에는 tenant_id 자동 설정 트리거가 없으므로
--   이미 위치를 쓰고 있는 tenant 를 그대로 가져와 넣는다.
-- ★ sort_order = 0 — 기존 행은 planReorder 가 1..N 으로 번호를 매기므로 0 은 비어 있다.
--   화면도 시스템 행을 정렬과 무관하게 맨 위에 고정하지만, 번호로도 맨 앞이 되게 둔다.
-- ★ code 는 「설명」으로 재활용되는 칸이다(0030 규약). label 과 다르게 두면 설명으로 보인다.
-- ★ (tenant_id, label) 이 UNIQUE 라 두 번 돌려도 한 행만 남는다.
insert into public.location_vocab (tenant_id, code, label, sort_order, is_active, is_system)
select distinct v.tenant_id,
       '치울 곳을 정하는 중인 약품',
       '임시보관(미지정)',
       0,
       true,
       true
  from public.location_vocab v
 where not exists (
   select 1 from public.location_vocab x
    where x.tenant_id = v.tenant_id and x.label = '임시보관(미지정)'
 )
on conflict (tenant_id, label) do nothing;

notify pgrst, 'reload schema';

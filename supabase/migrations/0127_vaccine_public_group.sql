-- ═══════════════════════════════════════════════════════════════
-- 0127 — 백신 계정에 「시즌 / 상시」 구분 칸을 더한다
--
-- 왜
--   독감·코로나는 절기마다 열렸다 닫히는 **시즌 백신**이고,
--   폐렴구균·대상포진은 절기가 없는 **상시 백신**이다.
--   공개 화면을 위(시즌)·아래(상시) 두 칸으로 나누려면 그 구분이 데이터에 있어야 한다.
--
--   ★ 「이름에 적어 두기」로 하지 않는다 — 글자 약속은 이미 두 번 어긋났다.
--     (공개 제품명 벗기기 규칙 2026-10-30 사례)
--
-- 안전한 점
--   · 기본값이 '시즌' 이라 **지금 있는 계정 5개는 손대지 않아도** 전부 시즌으로 채워진다.
--   · 권한은 표 수준(GRANT ... ON TABLE)으로 걸려 있어 새 칸에 **자동으로** 붙는다.
--   · 읽기 전용(viewer) 차단은 trg_viewer_readonly 트리거가 이미 표 전체를 막는다.
--
-- ★ 함정 #22 — 칸을 더한 뒤 **PostgREST 스키마 캐시를 갱신**하고,
--   새 칸이 API 에서 보이는 것을 확인한 다음에 그 칸을 쓰는 코드를 배포한다.
--   (캐시가 낡은 동안에는 실재하는 칸에도 PGRST204 가 난다)
-- ═══════════════════════════════════════════════════════════════

alter table public.vaccine_accounts
  add column if not exists public_group text not null default '시즌';

alter table public.vaccine_accounts
  drop constraint if exists vaccine_accounts_public_group_chk;

alter table public.vaccine_accounts
  add constraint vaccine_accounts_public_group_chk
  check (public_group in ('시즌', '상시'));

comment on column public.vaccine_accounts.public_group is
  '공개 화면 묶음 — 시즌(독감·코로나) / 상시(폐렴구균·대상포진). 0127';

-- ★ 스키마 캐시 갱신 — 이 줄이 빠지면 새 칸이 API 에 안 보인다(함정 #22)
notify pgrst, 'reload schema';

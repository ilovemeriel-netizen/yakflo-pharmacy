-- 0106_snapshot_created_at.sql
--
-- 목적: monthly_snapshots 에 **마감을 언제 실행했는지**를 남긴다.
--
-- 왜 필요한가 (2026-11-03 실측)
--   · 9월 마감에 10월 거래 3종(약 7,162원)이 섞인 것을 확인했는데,
--     **마감 실행 시각이 DB 에 없어** 섞인 범위를 거래 입력 시각으로 역산해야 했다.
--     (10-13 14시 입력분은 섞이고 16시 입력분은 안 섞여 → 마감은 그 사이로 추정)
--   · 마감은 「실행 시점의 현재고」를 기말로 적으므로(App.jsx:6061),
--     **언제 눌렀는지**가 그달 숫자의 의미를 좌우한다. 그 시각이 없으면 나중에 되짚을 수 없다.
--   · 인계문서 백로그 「월마감 시각 미기록」 항목을 해소한다.
--
-- ★ expand 순서를 지킨다 (CLAUDE.md) — **칸 먼저, 코드 나중**.
--   이 파일로 칸을 만들고 → NOTIFY pgrst, 'reload schema' → API 에서 보이는지 확인한 뒤에야
--   그 칸을 읽는 화면 코드를 배포한다. 캐시가 낡은 동안에는 실재하는 칸에도 PGRST204 가 난다.
--
-- ★ 이미 마감된 1~9월은 **NULL 로 둔다**. 지난 시각을 지어내지 않는다.
--   9월 마감 시각은 거래 입력 시각으로 역산한 **2026-10-13 14~16시 추정**이 전부이고,
--   그 추정은 인계문서에 글로만 적는다(값으로 채우지 않는다).
--
-- ★ NULL 허용·DEFAULT now() — 앞으로 들어오는 행만 자동으로 시각을 갖는다.
--   NOT NULL 로 걸면 기존 1,125×9개월 행을 전부 채워야 하므로 **일부러 걸지 않는다**.
--
-- ★★ 칸을 먼저 만들고 DEFAULT 를 **나중에** 건다 — 한 줄로 합치면 안 된다.
--   `add column … default now()` 로 쓰면 PostgreSQL 이 **기존 행까지 그 값으로 채운다**.
--   dryrun 에서 실제로 9,881행 전부에 적용 시각이 들어갔다 — 그러면 1~9월 마감 시각이
--   「2026-11-03」 으로 **거짓 기록**된다. 두 줄로 나누면 기존 행은 NULL 로 남는다.

begin;

alter table public.monthly_snapshots
  add column if not exists created_at timestamptz;

alter table public.monthly_snapshots
  alter column created_at set default now();

comment on column public.monthly_snapshots.created_at is
  '마감(스냅샷 생성) 시각. 2026-11-03 이전 마감분은 NULL — 당시 기록이 없어 소급하지 않는다.';

commit;

-- PostgREST 스키마 캐시 갱신 — 이 줄까지 돌려야 API 에서 새 칸이 보인다.
notify pgrst, 'reload schema';

-- ═══ 확인 (읽기 전용) ═══
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema='public' and table_name='monthly_snapshots' and column_name='created_at';
--   → timestamptz · YES · now()
--
--   select snap_year, snap_month, count(*) n, count(created_at) 시각있음
--     from public.monthly_snapshots group by 1,2 order by 1,2;
--   → 1~9월은 시각있음 0 (NULL 유지)

-- ═══ 되돌리기 (참고 — 실행하지 않음) ═══
--   alter table public.monthly_snapshots drop column if exists created_at;
--   ⚠ 10월 이후 마감 시각이 기록되기 시작한 뒤에는 그 값이 사라진다.

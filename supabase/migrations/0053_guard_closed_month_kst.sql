-- 0053_guard_closed_month_kst.sql
-- ⚠️ 0054에서 원복 — transaction_date가 date 컬럼이라 TZ 변환 불필요(본 KST 변환은 무해하나 불필요). 라이브 적용 이력 일치를 위해 파일 보존.
-- 목적: 마감월 가드의 귀속월 산정을 KST(Asia/Seoul) 기준으로 교정.
--   · 현행: extract(year/month from transaction_date) — 세션(UTC) 기준 → KST 월초 00:00~08:59 거래가 전월로 오귀속(경계 오차단).
--   · 조치: transaction_date 를 (… AT TIME ZONE 'Asia/Seoul') 로 변환 후 월 산정.
--   · ★ 0052(UPDATE 가드) 적용 전 현행 함수(INSERT·DELETE 2분기)를 대상으로 한다.
--     INSERT·DELETE 차단 로직·메시지·SECURITY DEFINER 등 구조 불변, 귀속월 TZ만 교정.

create or replace function public.guard_closed_month_tx()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  d   timestamp;   -- KST 벽시계 시각
  tid uuid;
begin
  if tg_op = 'DELETE' then
    d := old.transaction_date at time zone 'Asia/Seoul'; tid := old.tenant_id;
  else
    d := new.transaction_date at time zone 'Asia/Seoul'; tid := new.tenant_id;
  end if;

  if exists (
    select 1 from public.monthly_snapshots ms
    where ms.tenant_id  = tid
      and ms.snap_year  = extract(year  from d)::int
      and ms.snap_month = extract(month from d)::int
  ) then
    raise exception '마감된 월(%)의 거래는 수정할 수 없습니다. 먼저 해당 월 마감을 해제해 주세요.',
      to_char(d, 'YYYY-MM') using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end
$function$;

-- 트리거는 신설/변경 없음(기존 INSERT·DELETE 트리거가 이 함수를 그대로 호출).
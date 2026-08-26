-- 0078_bulk_stock_adjust_round_amount.sql
-- 목적: bulk_stock_adjust의 total_amount 계산을 반올림해 bigint 캐스트 실패 방지.
--   · 배경: transactions.total_amount = bigint. 조정거래 금액 = 차이수량(numeric) × purchase_price(numeric)이
--     소수가 되면(소수 재고 44종에서 발생) "invalid input syntax for type bigint" 캐스트 실패로 엑셀 재고조정·초기재고가 막힘.
--   · 조치: v_diff * coalesce(v_pp,0) → round(v_diff * coalesce(v_pp,0)) (원단위 정수). ±0.5원 반올림, 금액 실무 무영향.
--   · CREATE OR REPLACE — 함수 시그니처(jsonb,date,text)·파라미터·나머지 로직 전부 무변경. 유일 변경: 57행 total_amount에 round() 적용.
--   · quantity(v_diff)는 numeric 그대로 저장(반올림 안 함) — 소수 수량 보존.
--   · dryrun 필수(BEGIN → 검증 → ROLLBACK). apply 미실행(승인 후 별도 적용).

create or replace function public.bulk_stock_adjust(p_items jsonb, p_date date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tenant uuid;
  it jsonb; v_code text; v_target numeric; v_cur numeric; v_pp numeric; v_diff numeric;
  v_fail jsonb := '[]'::jsonb; v_succ int := 0; v_adj int := 0;
  v_y int := extract(year from p_date)::int; v_m int := extract(month from p_date)::int; v_closed boolean;
begin
  select tenant_id into v_tenant from public.tenant_members where user_id = auth.uid() limit 1;
  if v_tenant is null then raise exception 'tenant 확인 불가(로그인 필요)'; end if;
  select exists(select 1 from public.monthly_snapshots where tenant_id = v_tenant and snap_year = v_y and snap_month = v_m) into v_closed;

  -- Phase 1: 검증(쓰기 없음)
  for it in select value from jsonb_array_elements(p_items) loop
    v_code := it->>'drug_code'; v_target := nullif(it->>'target_qty','')::numeric;
    if v_code is null or v_code = '' or v_target is null then
      v_fail := v_fail || jsonb_build_array(jsonb_build_object('drug_code', v_code, 'reason', '약품코드/목표수량 누락'));
    elsif v_closed then
      v_fail := v_fail || jsonb_build_array(jsonb_build_object('drug_code', v_code, 'reason', '마감월('||v_y||'-'||lpad(v_m::text,2,'0')||') 조정 불가'));
    end if;
  end loop;
  if jsonb_array_length(v_fail) > 0 then
    return jsonb_build_object('ok', false, 'success', 0, 'adjusted', 0, 'failed', v_fail);
  end if;

  -- Phase 2: 적용(전부 검증 통과) — 예외 시 함수 전체 롤백
  for it in select value from jsonb_array_elements(p_items) loop
    v_code := it->>'drug_code'; v_target := (it->>'target_qty')::numeric;
    select current_qty, purchase_price into v_cur, v_pp from public.drugs where drug_code = v_code and tenant_id = v_tenant;
    if not found then
      insert into public.drugs(drug_code, drug_name, category, status, current_qty, purchase_price, tenant_id)
      values(v_code, coalesce(nullif(it->>'drug_name',''), v_code), coalesce(nullif(it->>'category',''), '경구제'),
             coalesce(nullif(it->>'status',''), '사용'), 0, nullif(it->>'purchase_price','')::numeric, v_tenant);
      v_cur := 0; v_pp := nullif(it->>'purchase_price','')::numeric;
    end if;
    v_succ := v_succ + 1;
    v_diff := v_target - coalesce(v_cur, 0);
    if v_diff <> 0 then
      insert into public.transactions(drug_code, type, quantity, total_amount, reason, transaction_date, tenant_id)
      values(v_code, '조정', v_diff, round(v_diff * coalesce(v_pp, 0)), p_reason, p_date, v_tenant);  -- 0078: round() 적용(bigint 캐스트 안전)
      v_adj := v_adj + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'success', v_succ, 'adjusted', v_adj, 'failed', '[]'::jsonb);
end $function$;

grant execute on function public.bulk_stock_adjust(jsonb, date, text) to authenticated;

-- 롤백(참고): 0057 원본 함수로 CREATE OR REPLACE 재적용(round 제거) 또는 drop function.

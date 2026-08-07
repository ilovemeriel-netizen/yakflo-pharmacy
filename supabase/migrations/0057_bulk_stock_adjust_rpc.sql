-- 0057_bulk_stock_adjust_rpc.sql
-- 목적: 대량 재고 반영을 서버 트랜잭션으로 처리하는 RPC — current_qty 직접쓰기 대체.
--   · 입력 p_items: [{drug_code, target_qty, drug_name?, category?, status?, purchase_price?}...]
--   · 동작(단일 트랜잭션):
--       - Phase1 검증: 코드/목표 누락·마감월 여부 → 실패행 수집. 실패 1건↑이면 쓰기 없이 실패목록 반환.
--       - Phase2 적용(검증 통과 시): 신규→drugs INSERT(current_qty=0)+조정거래(=target),
--                                   기존→(목표−현재) 차이만큼 조정거래(차이 0 skip).
--         조정거래는 apply_tx 트리거가 current_qty를 동기(직접 UPDATE 아님).
--   · total_amount = 차이수량 × purchase_price. transaction_date = p_date(당일).
--   · Phase2 중 예외(예: 마감월 가드)면 함수 전체 롤백(원자성). 반환: ok/성공/조정건수/실패목록.
--   · SECURITY DEFINER, tenant = auth.uid()의 tenant_members.
--   · dryrun 필수 → 결과 보고 → 승인 후 apply.

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
      values(v_code, '조정', v_diff, v_diff * coalesce(v_pp, 0), p_reason, p_date, v_tenant);
      v_adj := v_adj + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'success', v_succ, 'adjusted', v_adj, 'failed', '[]'::jsonb);
end $function$;

grant execute on function public.bulk_stock_adjust(jsonb, date, text) to authenticated;

-- 롤백(참고): drop function if exists public.bulk_stock_adjust(jsonb, date, text);
-- 마이그레이션 파일명이 테이블명으로 잘못 생성된 잔재 제거 (0행·무참조 확인)
DROP TABLE IF EXISTS "create_drug_lots.sql";

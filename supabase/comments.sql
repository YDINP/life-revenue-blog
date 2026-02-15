-- ============================================================
-- 댓글 시스템 테이블 + RPC 함수
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 1. comments 테이블
CREATE TABLE IF NOT EXISTS comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  post_slug text NOT NULL,
  source text NOT NULL DEFAULT 'blog' CHECK (source IN ('blog', 'lifeflow')),
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 2 AND 20),
  password_hash text NOT NULL,
  content text NOT NULL CHECK (char_length(content) BETWEEN 2 AND 500),
  parent_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  is_admin boolean DEFAULT false,
  ip_hash text,
  created_at timestamptz DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_comments_slug ON comments(post_slug, source);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);

-- RLS 활성화
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- 누구나 읽기 가능
CREATE POLICY "comments_select" ON comments FOR SELECT USING (true);

-- 누구나 삽입 가능 (anon)
CREATE POLICY "comments_insert" ON comments FOR INSERT WITH CHECK (true);

-- 삭제는 service_role만 (대시보드 Edge Function)
CREATE POLICY "comments_delete" ON comments FOR DELETE USING (false);

-- 2. comment_reports 테이블 (신고)
CREATE TABLE IF NOT EXISTS comment_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  reason text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE comment_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reports_select" ON comment_reports FOR SELECT USING (true);
CREATE POLICY "reports_insert" ON comment_reports FOR INSERT WITH CHECK (true);

-- ============================================================
-- RPC 함수
-- ============================================================

-- 3. 포스트별 댓글 조회
CREATE OR REPLACE FUNCTION get_comments(p_slug text, p_source text DEFAULT 'blog')
RETURNS json AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.created_at ASC), '[]'::json)
  FROM (
    SELECT id, post_slug, nickname, content, parent_id, is_admin, created_at
    FROM comments
    WHERE post_slug = p_slug AND source = p_source
  ) t;
$$ LANGUAGE sql STABLE;

-- 4. 댓글 등록
CREATE OR REPLACE FUNCTION submit_comment(
  p_slug text,
  p_source text,
  p_nickname text,
  p_password text,
  p_content text,
  p_parent_id uuid DEFAULT NULL,
  p_ip_hash text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO comments (post_slug, source, nickname, password_hash, content, parent_id, ip_hash)
  VALUES (p_slug, p_source, p_nickname, crypt(p_password, gen_salt('bf')), p_content, p_parent_id, p_ip_hash)
  RETURNING id INTO new_id;

  RETURN json_build_object('id', new_id, 'success', true);
END;
$$ LANGUAGE plpgsql;

-- 5. 대시보드: 댓글 통계
CREATE OR REPLACE FUNCTION get_comment_stats()
RETURNS json AS $$
  SELECT json_build_object(
    'total', (SELECT count(*) FROM comments),
    'today', (SELECT count(*) FROM comments WHERE created_at >= CURRENT_DATE),
    'reports', (SELECT count(DISTINCT comment_id) FROM comment_reports),
    'blog_count', (SELECT count(*) FROM comments WHERE source = 'blog'),
    'lifeflow_count', (SELECT count(*) FROM comments WHERE source = 'lifeflow')
  );
$$ LANGUAGE sql STABLE;

-- 6. 대시보드: 전체 댓글 목록 (최신순)
CREATE OR REPLACE FUNCTION get_all_comments(p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS json AS $$
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
  FROM (
    SELECT c.id, c.post_slug, c.source, c.nickname, c.content,
           c.parent_id, c.is_admin, c.created_at,
           (SELECT count(*) FROM comment_reports cr WHERE cr.comment_id = c.id) as report_count
    FROM comments c
    ORDER BY c.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;
$$ LANGUAGE sql STABLE;

-- 7. 대시보드: 7일 댓글 트렌드
CREATE OR REPLACE FUNCTION get_comment_trend()
RETURNS json AS $$
  SELECT coalesce(json_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::json)
  FROM (
    SELECT date_trunc('day', created_at)::date as day,
           count(*) as count,
           count(*) FILTER (WHERE source = 'blog') as blog_count,
           count(*) FILTER (WHERE source = 'lifeflow') as lf_count
    FROM comments
    WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
    GROUP BY date_trunc('day', created_at)::date
  ) t;
$$ LANGUAGE sql STABLE;

-- 8. 댓글 삭제 (비밀번호 확인)
CREATE OR REPLACE FUNCTION delete_comment(p_id uuid, p_password text)
RETURNS json AS $$
DECLARE
  stored_hash text;
BEGIN
  SELECT password_hash INTO stored_hash FROM comments WHERE id = p_id;
  IF stored_hash IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'not_found');
  END IF;
  IF stored_hash = crypt(p_password, stored_hash) THEN
    DELETE FROM comments WHERE id = p_id;
    RETURN json_build_object('success', true);
  ELSE
    RETURN json_build_object('success', false, 'error', 'wrong_password');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- 9. 대시보드: 관리자 삭제 (비밀번호 없이)
CREATE OR REPLACE FUNCTION admin_delete_comment(p_id uuid, p_admin_key text)
RETURNS json AS $$
BEGIN
  -- 간단한 관리자 키 검증 (환경변수 대신 하드코딩, 추후 변경 가능)
  IF p_admin_key != 'blog-admin-2026!' THEN
    RETURN json_build_object('success', false, 'error', 'unauthorized');
  END IF;
  DELETE FROM comments WHERE id = p_id;
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql;

-- 10. 대시보드: 관리자 답변
CREATE OR REPLACE FUNCTION admin_reply(
  p_parent_id uuid,
  p_slug text,
  p_source text,
  p_content text,
  p_admin_key text
)
RETURNS json AS $$
DECLARE
  new_id uuid;
BEGIN
  IF p_admin_key != 'blog-admin-2026!' THEN
    RETURN json_build_object('success', false, 'error', 'unauthorized');
  END IF;
  INSERT INTO comments (post_slug, source, nickname, password_hash, content, parent_id, is_admin)
  VALUES (p_slug, p_source, '관리자', '', p_content, p_parent_id, true)
  RETURNING id INTO new_id;
  RETURN json_build_object('id', new_id, 'success', true);
END;
$$ LANGUAGE plpgsql;

-- 11. 신고 등록
CREATE OR REPLACE FUNCTION report_comment(p_comment_id uuid, p_reason text DEFAULT '')
RETURNS json AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO comment_reports (comment_id, reason)
  VALUES (p_comment_id, p_reason)
  RETURNING id INTO new_id;
  RETURN json_build_object('id', new_id, 'success', true);
END;
$$ LANGUAGE plpgsql;

-- pgcrypto 확장 (crypt/gen_salt 사용)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

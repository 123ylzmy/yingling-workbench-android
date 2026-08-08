-- ============================================================
-- 自洽日程 · sync_store 安全收口（第一阶段：低风险、无需改前端）
-- ------------------------------------------------------------
-- 部署方式（3 步，需在 Supabase 后台手动执行一次）：
--   1) 打开 https://app.supabase.com → 你的项目
--   2) 左侧 SQL Editor → New query
--   3) 粘贴本文件全部内容 → Run
--
-- 作用：
--   1) 启用 RLS（此前实际未启用，anon 角色可任意读写整张表）
--   2) 禁止 anon 删除（应用从不删除数据，杜绝被恶意清空）
--   3) 限制 anon 写入仅限本应用使用的 个 store，防止越权建行 / 污染其他表
--   4) 建立 (group_key, store) 唯一约束，便于后续 upsert 与防重
--
-- 注意（重要）：anon 角色无身份标识，单纯 RLS 无法按"用户"隔离数据。
-- 因此本阶段仍允许 anon 读取任意行（按 group_key）、写入已知的 3 个 store。
-- 要彻底隔离（他人无法读写你的数据），需第二阶段：
--   把所有写操作改走 SECURITY DEFINER 的 RPC 函数，并验证归属，
--   再进一步禁止 anon 直写。详见迁移 0003（后续提供）。
-- ============================================================

begin;

-- 1) 唯一约束（已确认无重复行，可安全创建；用于后续 upsert 与防重）
create unique index if not exists sync_store_gk_store_uniq
  on sync_store (group_key, store);

-- 2) 启用行级安全
alter table sync_store enable row level security;

-- 3) 清理同名旧策略（幂等，重复执行不报错）
drop policy if exists "anon_select"        on sync_store;
drop policy if exists "anon_insert_scoped" on sync_store;
drop policy if exists "anon_update_scoped" on sync_store;
drop policy if exists "anon_delete_deny"   on sync_store;

-- 4) 读：保留 anon 读（应用需拉取自己的数据；彻底隔离见第二阶段）
create policy "anon_select" on sync_store
  for select to anon using (true);

-- 5) 写：仅限本应用使用的已知 store，杜绝越权建行 / 污染其他表
create policy "anon_insert_scoped" on sync_store
  for insert to anon
  with check (
    store in ('wb_yingling_v2', 'wb_profile_lookup', 'wb_user_profile')
  );

create policy "anon_update_scoped" on sync_store
  for update to anon
  using  (
    store in ('wb_yingling_v2', 'wb_profile_lookup', 'wb_user_profile')
  )
  with check (
    store in ('wb_yingling_v2', 'wb_profile_lookup', 'wb_user_profile')
  );

-- 6) 删：禁止 anon（应用无任何删除操作）
create policy "anon_delete_deny" on sync_store
  for delete to anon using (false);

commit;

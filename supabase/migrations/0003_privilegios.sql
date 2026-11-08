-- =====================================================================
-- ArenaIntinerante — 0003_privilegios.sql
-- Corrige permissões (GRANT) excedentes de PUBLIC/anon/authenticated
-- nas tabelas participantes, checkins, feedbacks e membros_equipe.
--
-- Motivo: a auditoria no projeto de testes encontrou, para authenticated,
-- INSERT/UPDATE/DELETE de TABELA INTEIRA (concedidos por postgres) em
-- participantes, checkins e feedbacks, além do modelo da 0002.
--
-- NÃO altera RLS, políticas, triggers, tabelas ou funções.
-- NÃO altera permissões de postgres (dono) nem de service_role.
-- Transacional: qualquer divergência no resultado gera erro e desfaz TUDO.
--
-- Pré-requisito: 0001 e 0002 executadas. Executar UMA vez, como postgres.
--
-- Modelo autorizado (somente authenticated; anon e PUBLIC: nada):
--   participantes : SELECT; INSERT (id, apelido, cidade, idade);
--                   UPDATE (apelido, cidade, idade)
--   checkins      : SELECT; INSERT (participante_id, arena_id, estacao);
--                   UPDATE (status)
--   feedbacks     : SELECT; INSERT (checkin_id, participante_id, nota, comentario);
--                   UPDATE (nota, comentario)
--   membros_equipe: SELECT
--   Nenhum DELETE, TRUNCATE, REFERENCES, TRIGGER ou MAINTAIN (PostgreSQL 17+).
--   Nada com GRANT OPTION.
--
-- TRAVA DE DESTINO (etapa 0a):
--   O SQL não expõe o Project ID do Supabase. A trava usa o
--   system_identifier do PostgreSQL (único por banco), que precisa ser
--   lido UMA vez no projeto ArenaIntinerante-Testes (somente leitura):
--     select system_identifier from pg_control_system();
--   e copiado para c_banco_autorizado abaixo. Enquanto estiver vazio, ou
--   se o banco for outro, ou se não for possível ler o identificador,
--   a migração é cancelada ANTES de qualquer REVOKE/GRANT.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0a. Trava de destino: só o banco do ArenaIntinerante-Testes.
-- ---------------------------------------------------------------------
do $$
declare
  -- PENDENTE: system_identifier do banco do ArenaIntinerante-Testes
  -- (vacdiqjcvmfbmegiibat), lido no próprio projeto de teste.
  c_banco_autorizado constant text := '7703760980994770283';
  v_banco_atual text;
begin
  if c_banco_autorizado !~ '^[0-9]{10,20}$' then
    raise exception 'PENDENTE: preencha c_banco_autorizado com o system_identifier do ArenaIntinerante-Testes. Nada foi alterado.';
  end if;

  begin
    select system_identifier::text into v_banco_atual from pg_control_system();
  exception
    when insufficient_privilege then
      raise exception 'Destino NÃO verificável (sem permissão para pg_control_system). Nada foi alterado.';
  end;

  if v_banco_atual is distinct from c_banco_autorizado then
    raise exception 'Destino NÃO autorizado: este banco não é o ArenaIntinerante-Testes. Nada foi alterado.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 0b. "Foto" das permissões administrativas (postgres e service_role),
--     para provar no fim que não mudaram. MAINTAIN só existe no PG 17+.
-- ---------------------------------------------------------------------
create temp table _efetivo_admin_antes on commit drop as
select r.papel::name as papel, t.tabela, p.privilegio,
       has_table_privilege(r.papel::name, t.tabela, p.privilegio) as tem
from (values ('postgres'), ('service_role')) r(papel)
cross join unnest(array['public.participantes', 'public.checkins',
                        'public.feedbacks', 'public.membros_equipe']::regclass[]) t(tabela)
cross join unnest(
  array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']::text[]
  || case when current_setting('server_version_num')::int >= 170000
          then array['MAINTAIN']::text[] else array[]::text[] end
) p(privilegio);

create temp table _acl_admin_antes on commit drop as
select c.relname::text as tabela, ''::text as coluna, g.rolname::text as recebeu,
       a.privilege_type::text as privilegio, a.is_grantable
from pg_class c
cross join lateral aclexplode(c.relacl) a
join pg_roles g on g.oid = a.grantee
where c.oid in ('public.participantes'::regclass, 'public.checkins'::regclass,
                'public.feedbacks'::regclass, 'public.membros_equipe'::regclass)
  and g.rolname in ('postgres', 'service_role')
union all
select c.relname::text, att.attname::text, g.rolname::text,
       a.privilege_type::text, a.is_grantable
from pg_attribute att
join pg_class c on c.oid = att.attrelid
cross join lateral aclexplode(att.attacl) a
join pg_roles g on g.oid = a.grantee
where att.attrelid in ('public.participantes'::regclass, 'public.checkins'::regclass,
                       'public.feedbacks'::regclass, 'public.membros_equipe'::regclass)
  and att.attnum > 0 and not att.attisdropped
  and g.rolname in ('postgres', 'service_role');

-- ---------------------------------------------------------------------
-- 1. Remove TODAS as permissões de TABELA de PUBLIC, anon e authenticated.
--    (RESTRICT, o padrão: se houver permissões repassadas a terceiros,
--    o comando falha e nada é aplicado.)
-- ---------------------------------------------------------------------
revoke all on table public.participantes, public.checkins,
                    public.feedbacks, public.membros_equipe
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Remove, SEPARADAMENTE, todas as permissões de COLUNA de PUBLIC,
--    anon e authenticated que ainda existirem (lidas do catálogo).
-- ---------------------------------------------------------------------
do $$
declare
  v record;
begin
  for v in
    select distinct
           c.oid::regclass  as tabela,
           att.attname      as coluna,
           a.privilege_type as privilegio,
           case when a.grantee = 0 then 'public' else quote_ident(g.rolname) end as recebeu
    from pg_attribute att
    join pg_class c on c.oid = att.attrelid
    cross join lateral aclexplode(att.attacl) a
    left join pg_roles g on g.oid = a.grantee
    where att.attrelid in ('public.participantes'::regclass, 'public.checkins'::regclass,
                           'public.feedbacks'::regclass, 'public.membros_equipe'::regclass)
      and att.attnum > 0 and not att.attisdropped
      and (a.grantee = 0 or g.rolname in ('anon', 'authenticated'))
  loop
    execute format('revoke %s (%I) on table %s from %s',
                   v.privilegio, v.coluna, v.tabela, v.recebeu);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Concede exatamente o modelo autorizado (somente authenticated,
--    sem GRANT OPTION).
-- ---------------------------------------------------------------------
grant select                                                 on public.participantes  to authenticated;
grant insert (id, apelido, cidade, idade)                    on public.participantes  to authenticated;
grant update (apelido, cidade, idade)                        on public.participantes  to authenticated;

grant select                                                 on public.checkins       to authenticated;
grant insert (participante_id, arena_id, estacao)            on public.checkins       to authenticated;
grant update (status)                                        on public.checkins       to authenticated;

grant select                                                 on public.feedbacks      to authenticated;
grant insert (checkin_id, participante_id, nota, comentario) on public.feedbacks      to authenticated;
grant update (nota, comentario)                              on public.feedbacks      to authenticated;

grant select                                                 on public.membros_equipe to authenticated;

-- ---------------------------------------------------------------------
-- 4. Autoverificação. Qualquer divergência => erro => migração desfeita.
--    (a) diretas de tabela   (b) diretas de coluna, com is_grantable
--    (c) efetivas de tabela  (d) efetivas de coluna   [c e d incluem
--        herança e PUBLIC; só acusam o que EXCEDE ou FALTA no modelo]
--    (e) postgres/service_role inalterados   (f) RLS e políticas intactos
-- ---------------------------------------------------------------------
do $$
declare
  v_tabelas constant regclass[] := array['public.participantes', 'public.checkins',
                                         'public.feedbacks', 'public.membros_equipe']::regclass[];
  -- Privilégios de tabela existentes nesta versão (MAINTAIN só no PG 17+).
  v_privs_tabela constant text[] :=
    array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']::text[]
    || case when current_setting('server_version_num')::int >= 170000
            then array['MAINTAIN']::text[] else array[]::text[] end;
  v_erro     text;
  v_heranca  text;
begin
  -- Informativo (usado só nas mensagens de erro de c/d): de quais papéis
  -- anon/authenticated são membros.
  select string_agg(format('%s é membro de %s', m.rolname, r.rolname), ', ')
    into v_heranca
  from pg_auth_members am
  join pg_roles r on r.oid = am.roleid
  join pg_roles m on m.oid = am.member
  where m.rolname in ('anon', 'authenticated');

  -- (a) DIRETAS de tabela: só SELECT, sem GRANT OPTION, para authenticated;
  --     nada para PUBLIC/anon.
  select string_agg(format('%s:%s:%s%s', c.relname, coalesce(g.rolname, 'PUBLIC'),
                           a.privilege_type, case when a.is_grantable then '(grant option)' else '' end), ', ')
    into v_erro
  from pg_class c
  cross join lateral aclexplode(c.relacl) a
  left join pg_roles g on g.oid = a.grantee
  where c.oid = any (v_tabelas)
    and (a.grantee = 0 or g.rolname in ('anon', 'authenticated'))
    and not (coalesce(g.rolname, '') = 'authenticated'
             and a.privilege_type = 'SELECT'
             and not a.is_grantable);
  if v_erro is not null then
    raise exception '0003 (a) permissões DIRETAS de tabela excedentes: %', v_erro;
  end if;

  select string_agg(t::text, ', ') into v_erro
  from unnest(v_tabelas) t
  where not exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    join pg_roles g on g.oid = a.grantee
    where c.oid = t and g.rolname = 'authenticated' and a.privilege_type = 'SELECT');
  if v_erro is not null then
    raise exception '0003 (a) SELECT ausente para authenticated em: %', v_erro;
  end if;

  -- (b) DIRETAS de coluna: exatamente as planejadas, para authenticated,
  --     SEM GRANT OPTION; nenhuma para PUBLIC/anon.
  with esperado(recebeu, tabela, coluna, privilegio, repassavel) as (values
    ('authenticated', 'participantes', 'id',              'INSERT', false),
    ('authenticated', 'participantes', 'apelido',         'INSERT', false),
    ('authenticated', 'participantes', 'cidade',          'INSERT', false),
    ('authenticated', 'participantes', 'idade',           'INSERT', false),
    ('authenticated', 'participantes', 'apelido',         'UPDATE', false),
    ('authenticated', 'participantes', 'cidade',          'UPDATE', false),
    ('authenticated', 'participantes', 'idade',           'UPDATE', false),
    ('authenticated', 'checkins',      'participante_id', 'INSERT', false),
    ('authenticated', 'checkins',      'arena_id',        'INSERT', false),
    ('authenticated', 'checkins',      'estacao',         'INSERT', false),
    ('authenticated', 'checkins',      'status',          'UPDATE', false),
    ('authenticated', 'feedbacks',     'checkin_id',      'INSERT', false),
    ('authenticated', 'feedbacks',     'participante_id', 'INSERT', false),
    ('authenticated', 'feedbacks',     'nota',            'INSERT', false),
    ('authenticated', 'feedbacks',     'comentario',      'INSERT', false),
    ('authenticated', 'feedbacks',     'nota',            'UPDATE', false),
    ('authenticated', 'feedbacks',     'comentario',      'UPDATE', false)
  ), atual as (
    select coalesce(g.rolname, 'PUBLIC')::text as recebeu,
           c.relname::text                     as tabela,
           att.attname::text                   as coluna,
           a.privilege_type::text              as privilegio,
           a.is_grantable                      as repassavel
    from pg_attribute att
    join pg_class c on c.oid = att.attrelid
    cross join lateral aclexplode(att.attacl) a
    left join pg_roles g on g.oid = a.grantee
    where att.attrelid = any (v_tabelas) and att.attnum > 0 and not att.attisdropped
      and (a.grantee = 0 or g.rolname in ('anon', 'authenticated'))
  ), diferenca as (
    (select 'faltando'::text  as tipo, * from esperado except select 'faltando'::text,  * from atual)
    union all
    (select 'excedente'::text as tipo, * from atual    except select 'excedente'::text, * from esperado)
  )
  select string_agg(format('%s %s %s.%s:%s%s', tipo, recebeu, tabela, coluna, privilegio,
                           case when repassavel then '(grant option)' else '' end), ', ')
    into v_erro
  from diferenca;
  if v_erro is not null then
    raise exception '0003 (b) permissões DIRETAS de coluna divergentes: %', v_erro;
  end if;

  -- (c) EFETIVAS de tabela (incluem herança e PUBLIC):
  --     anon: nenhuma; authenticated: somente SELECT.
  select string_agg(format('%s:%s:%s=%s', r.papel, t, p.privilegio,
                           has_table_privilege(r.papel, t, p.privilegio)), ', ')
    into v_erro
  from (values ('anon'::name), ('authenticated'::name)) r(papel)
  cross join unnest(v_tabelas) t
  cross join unnest(v_privs_tabela) p(privilegio)
  where has_table_privilege(r.papel, t, p.privilegio)
        is distinct from (r.papel = 'authenticated' and p.privilegio = 'SELECT');
  if v_erro is not null then
    raise exception '0003 (c) permissões EFETIVAS de tabela fora do modelo: %', v_erro
      using hint = coalesce('Heranças: ' || v_heranca, 'anon/authenticated não são membros de outros papéis.');
  end if;

  -- (d) EFETIVAS de coluna (incluem herança e PUBLIC):
  --     authenticated: SELECT em todas as colunas + INSERT/UPDATE do modelo;
  --     anon: nenhuma; REFERENCES: nenhuma.
  with planejado(tabela, coluna, privilegio) as (values
    ('participantes', 'id', 'INSERT'),          ('participantes', 'apelido', 'INSERT'),
    ('participantes', 'cidade', 'INSERT'),      ('participantes', 'idade', 'INSERT'),
    ('participantes', 'apelido', 'UPDATE'),     ('participantes', 'cidade', 'UPDATE'),
    ('participantes', 'idade', 'UPDATE'),
    ('checkins', 'participante_id', 'INSERT'),  ('checkins', 'arena_id', 'INSERT'),
    ('checkins', 'estacao', 'INSERT'),          ('checkins', 'status', 'UPDATE'),
    ('feedbacks', 'checkin_id', 'INSERT'),      ('feedbacks', 'participante_id', 'INSERT'),
    ('feedbacks', 'nota', 'INSERT'),            ('feedbacks', 'comentario', 'INSERT'),
    ('feedbacks', 'nota', 'UPDATE'),            ('feedbacks', 'comentario', 'UPDATE')
  ), colunas as (
    select c.oid as tabela_oid, c.relname::text as tabela, att.attnum, att.attname::text as coluna
    from pg_attribute att
    join pg_class c on c.oid = att.attrelid
    where att.attrelid = any (v_tabelas) and att.attnum > 0 and not att.attisdropped
  ), esperado as (
    select 'authenticated'::text as papel, k.tabela, k.coluna, 'SELECT'::text as privilegio
    from colunas k
    union
    select 'authenticated'::text, pl.tabela::text, pl.coluna::text, pl.privilegio::text
    from planejado pl
  ), atual as (
    select r.papel::text as papel, k.tabela, k.coluna, p.privilegio::text as privilegio
    from (values ('anon'::name), ('authenticated'::name)) r(papel)
    cross join colunas k
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(privilegio)
    where has_column_privilege(r.papel, k.tabela_oid, k.attnum, p.privilegio)
  ), diferenca as (
    (select 'faltando'::text  as tipo, * from esperado except select 'faltando'::text,  * from atual)
    union all
    (select 'excedente'::text as tipo, * from atual    except select 'excedente'::text, * from esperado)
  )
  select string_agg(format('%s %s %s.%s:%s', tipo, papel, tabela, coluna, privilegio), ', ')
    into v_erro
  from diferenca;
  if v_erro is not null then
    raise exception '0003 (d) permissões EFETIVAS de coluna fora do modelo: %', v_erro
      using hint = coalesce('Heranças: ' || v_heranca, 'anon/authenticated não são membros de outros papéis.');
  end if;

  -- (e) postgres e service_role: permissões efetivas e diretas inalteradas.
  select string_agg(format('%s:%s:%s', papel, tabela, privilegio), ', ')
    into v_erro
  from _efetivo_admin_antes
  where tem is distinct from has_table_privilege(papel, tabela, privilegio);
  if v_erro is not null then
    raise exception '0003 (e) permissões EFETIVAS de postgres/service_role mudaram: %', v_erro;
  end if;

  with depois as (
    select c.relname::text as tabela, ''::text as coluna, g.rolname::text as recebeu,
           a.privilege_type::text as privilegio, a.is_grantable
    from pg_class c
    cross join lateral aclexplode(c.relacl) a
    join pg_roles g on g.oid = a.grantee
    where c.oid = any (v_tabelas) and g.rolname in ('postgres', 'service_role')
    union all
    select c.relname::text, att.attname::text, g.rolname::text,
           a.privilege_type::text, a.is_grantable
    from pg_attribute att
    join pg_class c on c.oid = att.attrelid
    cross join lateral aclexplode(att.attacl) a
    join pg_roles g on g.oid = a.grantee
    where att.attrelid = any (v_tabelas) and att.attnum > 0 and not att.attisdropped
      and g.rolname in ('postgres', 'service_role')
  ), diferenca as (
    (select 'removida'::text   as tipo, * from _acl_admin_antes except select 'removida'::text,   * from depois)
    union all
    (select 'adicionada'::text as tipo, * from depois           except select 'adicionada'::text, * from _acl_admin_antes)
  )
  select string_agg(format('%s %s %s%s:%s', tipo, recebeu, tabela,
                           coalesce('.' || nullif(coluna, ''), ''), privilegio), ', ')
    into v_erro
  from diferenca;
  if v_erro is not null then
    raise exception '0003 (e) permissões DIRETAS de postgres/service_role mudaram: %', v_erro;
  end if;

  -- (f) RLS, FORCE RLS e políticas intactos.
  if (select count(*) from pg_class where oid = any (v_tabelas) and relrowsecurity) <> 4 then
    raise exception '0003 (f) RLS não está ativo nas 4 tabelas.';
  end if;
  if exists (select 1 from pg_class where oid = any (v_tabelas) and relforcerowsecurity) then
    raise exception '0003 (f) FORCE ROW LEVEL SECURITY inesperado.';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public'
        and tablename in ('participantes', 'checkins', 'feedbacks', 'membros_equipe')) <> 10 then
    raise exception '0003 (f) quantidade de políticas diferente de 10.';
  end if;
end $$;

commit;

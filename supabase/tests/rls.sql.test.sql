-- =====================================================================
-- ArenaIntinerante — testes de segurança RLS em SQL (C0 + T1–T19)
--
-- ONDE RODAR: SQL Editor do projeto de TESTE (ArenaIntinerante-Testes),
-- com o papel "postgres" (sem "impersonate"), depois de executar
-- 0001_esquema.sql e 0002_rls.sql nele.
--
-- POR QUE NADA FICA GRAVADO
--   * Todo o arquivo é UM ÚNICO comando (um bloco DO). Um comando é
--     sempre atômico: ou tudo, ou nada.
--   * O bloco termina com um RAISE EXCEPTION proposital contendo o
--     relatório. O erro desfaz TUDO (usuários temporários, linhas).
--   * Qualquer erro inesperado também desfaz tudo.
--   * Selecionar só um trecho do arquivo não executa nada: o trecho
--     fica incompleto e o PostgreSQL recusa (erro de sintaxe).
--
-- O RELATÓRIO APARECE COMO "ERRO" NO EDITOR. ISSO É ESPERADO.
--
-- RODAR SÓ ALGUNS TESTES: edite a variável v_selecao logo abaixo
-- (ex.: '{T4b,T9c}'). Vazio ('{}') = todos. A preparação comum e o
-- controle C0 rodam sempre. Cada teste cria os próprios dados.
--
-- TROCA DE PAPEL: cada teste simula o usuário com "set local role"
-- + request.jwt.claims e CONFERE current_user e auth.uid() antes de
-- testar; ao voltar, confere que o papel original foi restaurado.
-- Se qualquer conferência falhar, a execução inteira é abortada.
-- =====================================================================
do $teste$
declare
  -- ===== SELEÇÃO DE TESTES (vazio = todos) ============================
  v_selecao text[] := '{}';
  -- ===================================================================
  v_conhecidos constant text[] := array[
    'T1','T2','T3','T4','T4b','T5','T6','T7','T7b','T7c','T7d','T8',
    'T9','T9b','T9c','T10','T11','T12','T13','T14','T15','T16','T17','T18','T19'];

  v_original text := current_user;
  v_tag text := 'rls-sql-' || substr(md5(random()::text), 1, 8);
  v_sep constant text := chr(31);
  v_res text[] := '{}';

  -- Usuários temporários
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_p uuid := gen_random_uuid();
  v_e uuid := gen_random_uuid();
  v_x uuid := gen_random_uuid();
  v_jwt_a text; v_jwt_b text; v_jwt_e text; v_jwt_x text;

  -- Auxiliares
  v_ok boolean; v_det text; v_n int; v_m int; v_hint text;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_f1 uuid; v_f2 uuid;
  v_t1 timestamptz; v_t2 timestamptz; v_txt text; v_txt2 text;
  v_status text; v_dono uuid; v_ids uuid[]; v_r boolean;
  v_alvo record; v_tab text; v_linha text;
  v_passou int := 0; v_falhou int := 0; v_relatorio text := '';
begin
  -- -------------------------------------------------------------------
  -- 0. Verificações iniciais
  -- -------------------------------------------------------------------
  if v_original in ('anon', 'authenticated') then
    raise exception 'Rode como postgres (desative o "impersonate" do SQL Editor).';
  end if;
  if exists (select 1 from unnest(v_selecao) s where s <> all (v_conhecidos)) then
    raise exception 'v_selecao contém teste desconhecido. Válidos: %', array_to_string(v_conhecidos, ', ');
  end if;

  v_jwt_a := json_build_object('sub', v_a, 'role', 'authenticated', 'is_anonymous', true)::text;
  v_jwt_b := json_build_object('sub', v_b, 'role', 'authenticated', 'is_anonymous', true)::text;
  v_jwt_e := json_build_object('sub', v_e, 'role', 'authenticated', 'is_anonymous', false)::text;
  v_jwt_x := json_build_object('sub', v_x, 'role', 'authenticated', 'is_anonymous', true)::text;

  -- -------------------------------------------------------------------
  -- 1. Preparação comum (como postgres; tudo será desfeito)
  -- -------------------------------------------------------------------
  insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) values
    (v_a, 'authenticated', 'authenticated', true,  now(), now()),
    (v_b, 'authenticated', 'authenticated', true,  now(), now()),
    (v_p, 'authenticated', 'authenticated', false, now(), now()),
    (v_e, 'authenticated', 'authenticated', false, now(), now()),
    (v_x, 'authenticated', 'authenticated', true,  now(), now());

  insert into public.membros_equipe (user_id) values (v_e), (v_x);   -- X: anônimo por engano
  insert into public.participantes (id, apelido, cidade, idade) values
    (v_a, 'Teste A', 'Teste', 20),
    (v_b, 'Teste B', 'Teste', 20);                                   -- P, E, X sem cadastro

  -- -------------------------------------------------------------------
  -- C0. Controle (sempre): a troca de papel é necessária e funciona
  -- -------------------------------------------------------------------
  select count(*) into v_n from public.participantes where id in (v_a, v_b);
  perform set_config('request.jwt.claims', v_jwt_a, true);
  set local role authenticated;
  if current_user <> 'authenticated' or auth.uid() is distinct from v_a then
    raise exception 'C0: simulação de A não foi aplicada.';
  end if;
  select count(*) into v_m from public.participantes;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  if current_user <> v_original then raise exception 'C0: papel original não foi restaurado.'; end if;
  if not (v_n = 2 and v_m = 1) then
    raise exception 'C0 falhou (postgres=%, A=%): a simulação não isola os dados; resultados seriam falsos.', v_n, v_m;
  end if;
  v_res := v_res || concat_ws(v_sep, 'true', 'C0', 'postgres vê 2 cadastros; A simulado vê 1', '');

  -- ===================================================================
  -- T1. anon não lê nenhuma tabela
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T1' = any (v_selecao) then
    foreach v_tab in array array['participantes', 'checkins', 'feedbacks', 'membros_equipe'] loop
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      set local role anon;
      if current_user <> 'anon' then raise exception 'T1: simulação de anon não foi aplicada.'; end if;
      begin
        execute format('select count(*) from public.%I', v_tab);
        v_ok := false; v_det := 'leitura permitida';
      exception
        when insufficient_privilege then v_ok := sqlerrm like 'permission denied for table%'; v_det := sqlerrm;
        when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
      end;
      reset role; perform set_config('request.jwt.claims', '', true);
      if current_user <> v_original then raise exception 'T1: papel original não restaurado.'; end if;
      v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T1', 'anon sem leitura em ' || v_tab, coalesce(v_det, ''));
    end loop;
  end if;

  -- ===================================================================
  -- T2. Cadastro só para si (X cria o próprio; A tenta criar o de P)
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T2' = any (v_selecao) then
    perform set_config('request.jwt.claims', v_jwt_x, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_x then raise exception 'T2: simulação de X falhou.'; end if;
    begin
      insert into public.participantes (apelido, cidade, idade) values ('Teste X', 'Teste', 20);
      get diagnostics v_n = row_count;
      v_ok := v_n = 1; v_det := 'linhas=' || v_n;
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T2: papel original não restaurado.'; end if;
    v_ok := v_ok and exists (select 1 from public.participantes where id = v_x);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T2', 'X cria o próprio cadastro', coalesce(v_det, ''));

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T2: simulação de A falhou.'; end if;
    begin
      insert into public.participantes (id, apelido, cidade, idade) values (v_p, 'Invasor', 'Teste', 20);
      v_ok := false; v_det := 'inseriu em nome de P';
    exception
      when insufficient_privilege then v_ok := sqlerrm like 'new row violates row-level security policy%'; v_det := sqlerrm;
      when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T2: papel original não restaurado.'; end if;
    v_ok := v_ok and not exists (select 1 from public.participantes where id = v_p);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T2', 'A não cria cadastro de P (violação de política)', coalesce(v_det, ''));
  end if;

  -- ===================================================================
  -- T3. Lê só o próprio cadastro
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T3' = any (v_selecao) then
    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T3: simulação de A falhou.'; end if;
    select count(*), max(id::text) into v_n, v_txt from public.participantes;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T3: papel original não restaurado.'; end if;
    v_res := v_res || concat_ws(v_sep, (v_n = 1 and v_txt = v_a::text)::text, 'T3', 'A lê só o próprio cadastro', 'linhas=' || v_n);
  end if;

  -- ===================================================================
  -- T4. Altera só campos permitidos do próprio cadastro
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T4' = any (v_selecao) then
    select criado_em into v_t1 from public.participantes where id = v_a;

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T4: simulação de A falhou.'; end if;
    begin
      update public.participantes set apelido = 'T4 ok' where id = v_a;
      get diagnostics v_n = row_count;
      v_ok := v_n = 1; v_det := 'linhas=' || v_n;
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T4: papel original não restaurado.'; end if;
    v_ok := v_ok and (select apelido = 'T4 ok' and atualizado_em is not null from public.participantes where id = v_a);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T4', 'A altera o apelido (atualizado_em pelo trigger)', coalesce(v_det, ''));

    foreach v_txt in array array['id', 'criado_em'] loop
      perform set_config('request.jwt.claims', v_jwt_a, true);
      set local role authenticated;
      if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T4: simulação de A falhou.'; end if;
      begin
        if v_txt = 'id' then
          update public.participantes set id = gen_random_uuid() where id = v_a;
        else
          update public.participantes set criado_em = '2000-01-01' where id = v_a;
        end if;
        v_ok := false; v_det := 'alterou ' || v_txt;
      exception
        when insufficient_privilege then v_ok := sqlerrm like 'permission denied for table%'; v_det := sqlerrm;
        when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
      end;
      reset role; perform set_config('request.jwt.claims', '', true);
      if current_user <> v_original then raise exception 'T4: papel original não restaurado.'; end if;
      v_ok := v_ok and exists (select 1 from public.participantes where id = v_a and criado_em = v_t1);
      v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T4', 'A não altera ' || v_txt || ' (sem permissão)', coalesce(v_det, ''));
    end loop;
  end if;

  -- ===================================================================
  -- T4b. Não altera o cadastro de outra pessoa
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T4b' = any (v_selecao) then
    select apelido, atualizado_em into v_txt, v_t1 from public.participantes where id = v_b;
    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T4b: simulação de A falhou.'; end if;
    begin
      update public.participantes set apelido = 'Invasor' where id = v_b;
      get diagnostics v_n = row_count;
      v_ok := v_n = 0; v_det := 'linhas=' || v_n;
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T4b: papel original não restaurado.'; end if;
    v_ok := v_ok and exists (select 1 from public.participantes
                             where id = v_b and apelido = v_txt and atualizado_em is not distinct from v_t1);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T4b', 'A não altera cadastro de B: 0 linhas, dados intactos', coalesce(v_det, ''));
  end if;

  -- ===================================================================
  -- T5. Check-in só para si e sempre na fila
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T5' = any (v_selecao) then
    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T5: simulação de A falhou.'; end if;
    begin
      insert into public.checkins (arena_id, estacao) values ('rls-teste', v_tag || '-T5')
      returning status, participante_id, concluido_em into v_status, v_dono, v_t1;
      v_ok := v_status = 'na_fila' and v_dono = v_a and v_t1 is null; v_det := 'status=' || v_status;
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.checkins (participante_id, arena_id, estacao) values (v_b, 'rls-teste', v_tag || '-T5-B');
      v_r := false; v_txt := 'inseriu em nome de B';
    exception
      when insufficient_privilege then v_r := sqlerrm like 'new row violates row-level security policy%'; v_txt := sqlerrm;
      when others then v_r := false; v_txt := sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.checkins (arena_id, estacao, status) values ('rls-teste', v_tag || '-T5-s', 'concluido');
      v_hint := 'false'; v_txt2 := 'informou status';
    exception
      when insufficient_privilege then v_hint := (sqlerrm like 'permission denied for table%')::text; v_txt2 := sqlerrm;
      when others then v_hint := 'false'; v_txt2 := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T5: papel original não restaurado.'; end if;
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T5', 'A cria check-in na fila para si', coalesce(v_det, ''));
    v_res := v_res || concat_ws(v_sep, coalesce(v_r, false)::text, 'T5', 'A não cria check-in de B (violação de política)', coalesce(v_txt, ''));
    v_res := v_res || concat_ws(v_sep, coalesce(v_hint, 'false'), 'T5', 'A não informa status (sem permissão)', coalesce(v_txt2, ''));
  end if;

  -- ===================================================================
  -- T6. Sem check-in duplicado
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T6' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao) values (v_a, 'rls-teste', v_tag || '-T6');

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T6: simulação de A falhou.'; end if;
    begin
      insert into public.checkins (arena_id, estacao) values ('rls-teste', v_tag || '-T6');
      v_ok := false; v_det := 'duplicou';
    exception
      when unique_violation then v_ok := true; v_det := sqlerrm;
      when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.checkins (arena_id, estacao) values ('rls-teste', v_tag || '-T6')
      on conflict (participante_id, arena_id, estacao) do nothing;
      get diagnostics v_n = row_count;
      v_r := v_n = 0; v_txt := 'linhas=' || v_n;
    exception when others then v_r := false; v_txt := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T6: papel original não restaurado.'; end if;
    select count(*) into v_n from public.checkins where participante_id = v_a and estacao = v_tag || '-T6';
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T6', 'duplicado recusado (23505)', coalesce(v_det, ''));
    v_res := v_res || concat_ws(v_sep, (coalesce(v_r, false) and v_n = 1)::text, 'T6', 'on conflict do nothing: 0 linhas; continua 1', coalesce(v_txt, ''));
  end if;

  -- ===================================================================
  -- T7. Conclui o próprio check-in
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T7' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T7') returning id into v_c1;

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T7: simulação de A falhou.'; end if;
    begin
      update public.checkins set status = 'concluido' where id = v_c1;
      get diagnostics v_n = row_count;
      v_ok := v_n = 1; v_det := 'linhas=' || v_n;
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T7: papel original não restaurado.'; end if;
    v_ok := v_ok and exists (select 1 from public.checkins where id = v_c1 and status = 'concluido' and concluido_em is not null);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T7', 'A conclui o próprio check-in (concluido_em pelo trigger)', coalesce(v_det, ''));
  end if;

  -- ===================================================================
  -- T7b. Não conclui duas vezes
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T7b' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T7b') returning id into v_c1;
    update public.checkins set status = 'concluido' where id = v_c1;
    select concluido_em into v_t1 from public.checkins where id = v_c1;

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T7b: simulação de A falhou.'; end if;
    begin
      update public.checkins set status = 'concluido' where id = v_c1;
      get diagnostics v_n = row_count;
      v_ok := v_n = 0; v_det := 'linhas=' || v_n;
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T7b: papel original não restaurado.'; end if;
    v_ok := v_ok and exists (select 1 from public.checkins where id = v_c1 and concluido_em = v_t1);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T7b', 'concluir de novo: 0 linhas; concluido_em intacto', coalesce(v_det, ''));
  end if;

  -- ===================================================================
  -- T7c. Não regrava status na fila
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T7c' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T7c') returning id into v_c1;

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T7c: simulação de A falhou.'; end if;
    begin
      update public.checkins set status = 'na_fila' where id = v_c1;
      v_ok := false; v_det := 'aceitou status na_fila';
    exception
      when insufficient_privilege then v_ok := sqlerrm like 'new row violates row-level security policy%'; v_det := sqlerrm;
      when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T7c: papel original não restaurado.'; end if;
    v_ok := v_ok and exists (select 1 from public.checkins where id = v_c1 and status = 'na_fila');
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T7c', 'status na_fila recusado (violação de política)', coalesce(v_det, ''));
  end if;

  -- ===================================================================
  -- T7d. Não conclui check-in de outra pessoa (o de B está NA FILA)
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T7d' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_b, 'rls-teste', v_tag || '-T7d') returning id into v_c1;

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T7d: simulação de A falhou.'; end if;
    begin
      update public.checkins set status = 'concluido' where id = v_c1;
      get diagnostics v_n = row_count;
      v_ok := v_n = 0; v_det := 'linhas=' || v_n;
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T7d: papel original não restaurado.'; end if;
    v_ok := v_ok and exists (select 1 from public.checkins where id = v_c1 and status = 'na_fila');
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T7d', 'A não conclui check-in de B: 0 linhas', coalesce(v_det, ''));
  end if;

  -- ===================================================================
  -- T8. Avalia só check-in próprio e concluído
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T8' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T8-fila') returning id into v_c1;
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T8-ok') returning id into v_c2;
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_b, 'rls-teste', v_tag || '-T8-B') returning id into v_c3;
    update public.checkins set status = 'concluido' where id in (v_c2, v_c3);

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T8: simulação de A falhou.'; end if;
    begin
      insert into public.feedbacks (checkin_id, nota) values (v_c1, 4);
      v_ok := false; v_det := 'avaliou check-in na fila';
    exception
      when raise_exception then
        get stacked diagnostics v_hint = pg_exception_hint;
        v_ok := v_hint = 'nao_permitido' and sqlerrm like 'Conclua a atividade%'; v_det := sqlerrm;
      when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.feedbacks (checkin_id, nota) values (v_c2, 4);
      v_r := true; v_txt := null;
    exception when others then v_r := false; v_txt := sqlstate || ' ' || sqlerrm;
    end;
    begin
      insert into public.feedbacks (checkin_id, nota) values (v_c3, 4);
      v_n := 0; v_txt2 := 'avaliou check-in de B';
    exception
      when raise_exception then
        get stacked diagnostics v_hint = pg_exception_hint;
        v_n := case when v_hint = 'nao_permitido' and sqlerrm = v_det then 1 else 0 end; v_txt2 := sqlerrm;
      when others then v_n := 0; v_txt2 := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T8: papel original não restaurado.'; end if;
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T8', 'avaliar check-in na fila: erro do trigger', coalesce(v_det, ''));
    v_res := v_res || concat_ws(v_sep, (coalesce(v_r, false)
                     and exists (select 1 from public.feedbacks where checkin_id = v_c2 and participante_id = v_a))::text,
                     'T8', 'avaliar check-in concluído próprio: ok', coalesce(v_txt, ''));
    v_res := v_res || concat_ws(v_sep, (v_n = 1 and not exists (select 1 from public.feedbacks where checkin_id = v_c3))::text,
                     'T8', 'avaliar check-in de B: mesmo erro (sem revelar)', coalesce(v_txt2, ''));
  end if;

  -- ===================================================================
  -- T9. Edita só nota e comentário da própria avaliação
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T9' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T9') returning id into v_c1;
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T9-outro') returning id into v_c2;
    update public.checkins set status = 'concluido' where id in (v_c1, v_c2);
    insert into public.feedbacks (checkin_id, participante_id, nota) values (v_c1, v_a, 3) returning id into v_f1;

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T9: simulação de A falhou.'; end if;
    begin
      update public.feedbacks set nota = 5, comentario = 'Muito bom' where id = v_f1;
      get diagnostics v_n = row_count;
      v_ok := v_n = 1; v_det := 'linhas=' || v_n;
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    begin
      update public.feedbacks set checkin_id = v_c2 where id = v_f1;
      v_r := false; v_txt := 'alterou checkin_id';
    exception
      when insufficient_privilege then v_r := sqlerrm like 'permission denied for table%'; v_txt := sqlerrm;
      when others then v_r := false; v_txt := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T9: papel original não restaurado.'; end if;
    v_ok := v_ok and exists (select 1 from public.feedbacks where id = v_f1 and nota = 5 and atualizado_em is not null);
    v_r := v_r and exists (select 1 from public.feedbacks where id = v_f1 and checkin_id = v_c1);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T9', 'A edita nota/comentário (atualizado_em pelo trigger)', coalesce(v_det, ''));
    v_res := v_res || concat_ws(v_sep, coalesce(v_r, false)::text, 'T9', 'A não altera checkin_id (sem permissão)', coalesce(v_txt, ''));
  end if;

  -- ===================================================================
  -- T9b. Upsert com SET checkin_id é barrado
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T9b' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T9b') returning id into v_c1;
    update public.checkins set status = 'concluido' where id = v_c1;
    insert into public.feedbacks (checkin_id, participante_id, nota) values (v_c1, v_a, 3) returning id into v_f1;

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T9b: simulação de A falhou.'; end if;
    begin
      insert into public.feedbacks (checkin_id, nota) values (v_c1, 5)
      on conflict (checkin_id) do update set checkin_id = excluded.checkin_id, nota = excluded.nota;
      v_ok := false; v_det := 'upsert aceito';
    exception
      when insufficient_privilege then v_ok := sqlerrm like 'permission denied for table%'; v_det := sqlerrm;
      when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T9b: papel original não restaurado.'; end if;
    v_ok := v_ok and exists (select 1 from public.feedbacks where id = v_f1 and nota = 3);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T9b', 'upsert com SET checkin_id barrado (sem permissão)', coalesce(v_det, ''));
  end if;

  -- ===================================================================
  -- T9c. Não altera a avaliação de outra pessoa
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T9c' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_b, 'rls-teste', v_tag || '-T9c') returning id into v_c1;
    update public.checkins set status = 'concluido' where id = v_c1;
    insert into public.feedbacks (checkin_id, participante_id, nota) values (v_c1, v_b, 3) returning id into v_f1;

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T9c: simulação de A falhou.'; end if;
    begin
      update public.feedbacks set nota = 1, comentario = 'Invasor' where id = v_f1;
      get diagnostics v_n = row_count;
      v_ok := v_n = 0; v_det := 'linhas=' || v_n;
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T9c: papel original não restaurado.'; end if;
    v_ok := v_ok and exists (select 1 from public.feedbacks
                             where id = v_f1 and nota = 3 and comentario is null and atualizado_em is null);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T9c', 'A não altera avaliação de B: 0 linhas, dados intactos', coalesce(v_det, ''));
  end if;

  -- ===================================================================
  -- T10. Nenhuma exclusão acontece (contagem antes e depois)
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T10' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T10') returning id into v_c1;
    update public.checkins set status = 'concluido' where id = v_c1;
    insert into public.feedbacks (checkin_id, participante_id, nota) values (v_c1, v_a, 3) returning id into v_f1;
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_b, 'rls-teste', v_tag || '-T10-B') returning id into v_c2;

    select (select count(*) from public.participantes where id in (v_a, v_b))
         + (select count(*) from public.checkins where id in (v_c1, v_c2))
         + (select count(*) from public.feedbacks where id = v_f1)
         + (select count(*) from public.membros_equipe where user_id = v_e)
      into v_n;

    v_ok := true; v_det := '';
    for v_alvo in
      select * from (values
        ('participantes', 'id', v_a), ('participantes', 'id', v_b),
        ('checkins', 'id', v_c1), ('checkins', 'id', v_c2),
        ('feedbacks', 'id', v_f1), ('membros_equipe', 'user_id', v_e)
      ) as t(tabela, coluna, alvo)
    loop
      perform set_config('request.jwt.claims', v_jwt_a, true);
      set local role authenticated;
      if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T10: simulação de A falhou.'; end if;
      begin
        execute format('delete from public.%I where %I = $1', v_alvo.tabela, v_alvo.coluna) using v_alvo.alvo;
        v_r := false; v_txt := 'DELETE aceito';
      exception
        when insufficient_privilege then v_r := sqlerrm like 'permission denied for table%'; v_txt := sqlerrm;
        when others then v_r := false; v_txt := sqlstate || ' ' || sqlerrm;
      end;
      reset role; perform set_config('request.jwt.claims', '', true);
      if current_user <> v_original then raise exception 'T10: papel original não restaurado.'; end if;
      v_ok := v_ok and coalesce(v_r, false);
      v_res := v_res || concat_ws(v_sep, coalesce(v_r, false)::text, 'T10', 'DELETE recusado em ' || v_alvo.tabela, coalesce(v_txt, ''));
    end loop;

    select (select count(*) from public.participantes where id in (v_a, v_b))
         + (select count(*) from public.checkins where id in (v_c1, v_c2))
         + (select count(*) from public.feedbacks where id = v_f1)
         + (select count(*) from public.membros_equipe where user_id = v_e)
      into v_m;
    v_res := v_res || concat_ws(v_sep, (v_n = 6 and v_m = v_n)::text, 'T10',
                     'nenhuma linha removida (antes = depois)', format('antes=%s, depois=%s', v_n, v_m));
  end if;

  -- ===================================================================
  -- T11. B não vê dados de A (com controle positivo)
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T11' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T11') returning id into v_c1;
    update public.checkins set status = 'concluido' where id = v_c1;
    insert into public.feedbacks (checkin_id, participante_id, nota) values (v_c1, v_a, 3);
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_b, 'rls-teste', v_tag || '-T11-B') returning id into v_c2;

    perform set_config('request.jwt.claims', v_jwt_b, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_b then raise exception 'T11: simulação de B falhou.'; end if;
    select count(*) into v_n from public.participantes;                                   -- controle: 1 (o de B)
    select count(*) into v_m from public.checkins where id = v_c2;                        -- controle: 1
    select (select count(*) from public.participantes where id = v_a)
         + (select count(*) from public.checkins where participante_id = v_a)
         + (select count(*) from public.feedbacks where participante_id = v_a)
      into v_hint;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T11: papel original não restaurado.'; end if;
    v_res := v_res || concat_ws(v_sep,
      (v_n = 1 and v_m = 1 and v_hint = '0'
        and exists (select 1 from public.feedbacks where participante_id = v_a))::text,
      'T11', 'B vê só o que é dele e nada de A', format('B: cadastros=%s, próprio check-in=%s, linhas de A=%s', v_n, v_m, v_hint));
  end if;

  -- ===================================================================
  -- T12. Participante não lê nem entra em membros_equipe
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T12' = any (v_selecao) then
    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T12: simulação de A falhou.'; end if;
    select count(*) into v_n from public.membros_equipe;
    begin
      insert into public.membros_equipe (user_id) values (v_a);
      v_ok := false; v_det := 'inseriu';
    exception
      when insufficient_privilege then v_ok := sqlerrm like 'permission denied for table%'; v_det := sqlerrm;
      when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T12: papel original não restaurado.'; end if;
    select count(*) into v_m from public.membros_equipe where user_id in (v_e, v_x);
    v_res := v_res || concat_ws(v_sep, (v_n = 0 and v_m = 2)::text, 'T12', 'A lê membros_equipe: 0 linhas (existem E e X)', 'linhas=' || v_n);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T12', 'A não se cadastra na equipe (sem permissão)', coalesce(v_det, ''));
  end if;

  -- ===================================================================
  -- T13. Equipe vê só a própria linha (X também está na tabela)
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T13' = any (v_selecao) then
    perform set_config('request.jwt.claims', v_jwt_e, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_e then raise exception 'T13: simulação de E falhou.'; end if;
    select count(*), max(user_id::text) into v_n, v_txt from public.membros_equipe;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T13: papel original não restaurado.'; end if;
    v_res := v_res || concat_ws(v_sep, (v_n = 1 and v_txt = v_e::text)::text, 'T13', 'E vê só a própria linha', 'linhas=' || v_n);
  end if;

  -- ===================================================================
  -- T14. Equipe não lê dados pessoais diretamente
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T14' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T14') returning id into v_c1;
    update public.checkins set status = 'concluido' where id = v_c1;
    insert into public.feedbacks (checkin_id, participante_id, nota) values (v_c1, v_a, 3);

    perform set_config('request.jwt.claims', v_jwt_e, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_e then raise exception 'T14: simulação de E falhou.'; end if;
    select (select count(*) from public.participantes)
         + (select count(*) from public.checkins)
         + (select count(*) from public.feedbacks)
      into v_n;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T14: papel original não restaurado.'; end if;
    v_res := v_res || concat_ws(v_sep,
      (v_n = 0 and exists (select 1 from public.feedbacks where checkin_id = v_c1))::text,
      'T14', 'E não lê cadastros, check-ins nem avaliações', 'linhas vistas por E=' || v_n);
  end if;

  -- ===================================================================
  -- T15. eh_equipe() por perfil (como postgres, login simulado)
  --      Remove E da equipe e RESTAURA no fim (sem efeito nos demais).
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T15' = any (v_selecao) then
    for v_alvo in
      select * from (values
        ('A', v_a, true, false), ('P', v_p, false, false),
        ('X', v_x, true, false), ('E', v_e, false, true)
      ) as t(nome, id, anonimo, esperado)
    loop
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_alvo.id, 'role', 'authenticated', 'is_anonymous', v_alvo.anonimo)::text, true);
      v_r := privado.eh_equipe();
      v_res := v_res || concat_ws(v_sep, (v_r is not distinct from v_alvo.esperado)::text, 'T15',
                       format('eh_equipe() para %s = %s', v_alvo.nome, v_alvo.esperado), 'obtido=' || coalesce(v_r::text, 'null'));
    end loop;

    perform set_config('request.jwt.claims', '', true);
    v_r := privado.eh_equipe();
    v_res := v_res || concat_ws(v_sep, (v_r is false)::text, 'T15', 'eh_equipe() sem login = false', 'obtido=' || coalesce(v_r::text, 'null'));

    delete from public.membros_equipe where user_id = v_e;
    perform set_config('request.jwt.claims', v_jwt_e, true);
    v_r := privado.eh_equipe();
    perform set_config('request.jwt.claims', '', true);
    insert into public.membros_equipe (user_id) values (v_e);   -- restaura
    v_res := v_res || concat_ws(v_sep, (v_r is false)::text, 'T15', 'eh_equipe() para E removido = false', 'obtido=' || coalesce(v_r::text, 'null'));
  end if;

  -- ===================================================================
  -- T16. Funções privadas inacessíveis a usuários
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T16' = any (v_selecao) then
    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T16: simulação de A falhou.'; end if;
    begin
      v_r := privado.eh_equipe();
      v_ok := false; v_det := 'chamada permitida';
    exception
      when insufficient_privilege then v_ok := true; v_det := sqlerrm;
      when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    begin
      perform privado.proteger_checkin();
      v_r := false; v_txt := 'chamada permitida';
    exception
      when insufficient_privilege then v_r := true; v_txt := sqlerrm;
      when others then v_r := false; v_txt := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T16: papel original não restaurado.'; end if;
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T16', 'A não chama privado.eh_equipe()', coalesce(v_det, ''));
    v_res := v_res || concat_ws(v_sep, coalesce(v_r, false)::text, 'T16', 'A não chama privado.proteger_checkin()', coalesce(v_txt, ''));
  end if;

  -- ===================================================================
  -- T17. Triggers disparam sob usuário comum e barram até o dono
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T17' = any (v_selecao) then
    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T17: simulação de A falhou.'; end if;
    begin
      insert into public.checkins (arena_id, estacao) values ('rls-teste', v_tag || '-T17') returning id into v_c1;
      update public.checkins set status = 'concluido' where id = v_c1;
      v_ok := true; v_det := null;
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T17: papel original não restaurado.'; end if;
    v_ok := v_ok and exists (select 1 from public.checkins
                             where id = v_c1 and criado_em is not null
                               and concluido_em is not null and concluido_em >= criado_em);
    v_res := v_res || concat_ws(v_sep, coalesce(v_ok, false)::text, 'T17', 'datas preenchidas pelo servidor sob usuário comum', coalesce(v_det, ''));

    begin
      insert into public.checkins (participante_id, arena_id, estacao, status)
      values (v_a, 'rls-teste', v_tag || '-T17-dono', 'concluido');
      v_r := false; v_txt := 'aceitou check-in já concluído';
    exception
      when raise_exception then
        get stacked diagnostics v_hint = pg_exception_hint;
        v_r := v_hint = 'validacao'; v_txt := sqlerrm;
      when others then v_r := false; v_txt := sqlstate || ' ' || sqlerrm;
    end;
    v_res := v_res || concat_ws(v_sep, coalesce(v_r, false)::text, 'T17', 'trigger recusa check-in criado como concluído (até para o dono)', coalesce(v_txt, ''));
  end if;

  -- ===================================================================
  -- T18. RETURNING devolve só linhas próprias
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T18' = any (v_selecao) then
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_a, 'rls-teste', v_tag || '-T18') returning id into v_c1;
    insert into public.checkins (participante_id, arena_id, estacao)
    values (v_b, 'rls-teste', v_tag || '-T18') returning id into v_c2;

    -- Pré-condição: os dois estão na fila e satisfazem o mesmo filtro.
    select count(*) into v_m from public.checkins
    where id in (v_c1, v_c2) and status = 'na_fila' and estacao = v_tag || '-T18';

    perform set_config('request.jwt.claims', v_jwt_a, true);
    set local role authenticated;
    if current_user <> 'authenticated' or auth.uid() is distinct from v_a then raise exception 'T18: simulação de A falhou.'; end if;
    begin
      with alterados as (
        update public.checkins set status = 'concluido'
        where status = 'na_fila' and estacao = v_tag || '-T18'
        returning id
      )
      select array_agg(id) into v_ids from alterados;
      v_ok := v_ids = array[v_c1]; v_det := 'devolvidas=' || coalesce(array_length(v_ids, 1), 0);
    exception when others then v_ok := false; v_det := sqlstate || ' ' || sqlerrm;
    end;
    reset role; perform set_config('request.jwt.claims', '', true);
    if current_user <> v_original then raise exception 'T18: papel original não restaurado.'; end if;
    v_ok := v_m = 2 and coalesce(v_ok, false)
            and exists (select 1 from public.checkins where id = v_c2 and status = 'na_fila');
    v_res := v_res || concat_ws(v_sep, v_ok::text, 'T18', 'RETURNING só com a linha de A; a de B continua na fila',
                     format('pré-condição=%s; %s', v_m, v_det));
  end if;

  -- ===================================================================
  -- T19. Conferência estrutural (somente leitura)
  -- ===================================================================
  if cardinality(v_selecao) = 0 or 'T19' = any (v_selecao) then
    select count(*) into v_n from pg_policies
    where schemaname = 'public' and tablename in ('participantes', 'checkins', 'feedbacks', 'membros_equipe');
    v_res := v_res || concat_ws(v_sep, (v_n = 10)::text, 'T19', '10 políticas', 'políticas=' || v_n);

    select count(*) into v_n from (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon'
        and table_name in ('participantes', 'checkins', 'feedbacks', 'membros_equipe')
      union all
      select 1 from information_schema.column_privileges
      where table_schema = 'public' and grantee = 'anon'
        and table_name in ('participantes', 'checkins', 'feedbacks', 'membros_equipe')
    ) s;
    v_res := v_res || concat_ws(v_sep, (v_n = 0)::text, 'T19', 'nenhuma permissão para anon', 'permissões=' || v_n);

    select (not prosecdef and proowner::regrole::text = 'postgres'), format('definer=%s dono=%s', prosecdef, proowner::regrole)
      into v_r, v_txt
    from pg_proc where oid = 'privado.eh_equipe()'::regprocedure;
    v_res := v_res || concat_ws(v_sep, coalesce(v_r, false)::text, 'T19', 'eh_equipe invoker e dona postgres', coalesce(v_txt, ''));

    select not relforcerowsecurity into v_r from pg_class where oid = 'public.membros_equipe'::regclass;
    v_res := v_res || concat_ws(v_sep, coalesce(v_r, false)::text, 'T19', 'membros_equipe sem FORCE RLS', '');

    select count(*) into v_n from pg_class
    where relnamespace = 'public'::regnamespace and relrowsecurity
      and relname in ('participantes', 'checkins', 'feedbacks', 'membros_equipe');
    v_res := v_res || concat_ws(v_sep, (v_n = 4)::text, 'T19', 'RLS ativo nas 4 tabelas', 'tabelas=' || v_n);
  end if;

  -- ===================================================================
  -- FINAL. Relatório + desfazer TUDO (o erro abaixo é proposital)
  -- ===================================================================
  foreach v_linha in array v_res loop
    if split_part(v_linha, v_sep, 1) = 'true' then v_passou := v_passou + 1; else v_falhou := v_falhou + 1; end if;
    v_relatorio := v_relatorio || E'\n' || format('%s  %-4s %s%s',
      case when split_part(v_linha, v_sep, 1) = 'true' then 'PASSOU' else 'FALHOU' end,
      split_part(v_linha, v_sep, 2),
      split_part(v_linha, v_sep, 3),
      case when split_part(v_linha, v_sep, 1) = 'true' or split_part(v_linha, v_sep, 4) = '' then ''
           else '  | ' || split_part(v_linha, v_sep, 4) end);
  end loop;

  raise exception using
    message = format(E'RELATÓRIO RLS: %s passaram, %s falharam (seleção: %s). Nenhum dado foi gravado.%s',
                     v_passou, v_falhou,
                     case when cardinality(v_selecao) = 0 then 'todos' else array_to_string(v_selecao, ', ') end,
                     v_relatorio),
    hint = 'Este erro é proposital: ele desfaz todas as alterações feitas pelos testes.';
end
$teste$;

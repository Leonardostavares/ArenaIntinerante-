-- =====================================================================
-- ArenaIntinerante — 0006_arenas_leitura_anon.sql
-- Corrige 0005: o app lista as arenas ANTES do cadastro/login, quando a
-- sessão ainda é "anon". A 0005 só liberou SELECT para "authenticated",
-- gerando erro 42501 (permission denied) na tela de arenas.
--
-- Libera SOMENTE SELECT para anon. INSERT/UPDATE/DELETE continuam
-- restritos à equipe (políticas da 0005, todas "to authenticated").
-- Os dados de arena (nome, local, estações) são públicos por natureza.
-- Pré-requisito: 0005 executada. Executar UMA vez.
-- =====================================================================
begin;

grant select on public.arenas to anon;

create policy "anon lê arenas"
  on public.arenas for select to anon
  using (true);

commit;

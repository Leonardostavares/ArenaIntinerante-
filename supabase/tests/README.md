# Testes de segurança RLS (T1–T19)

Testes das migrações `0001_esquema.sql` e `0002_rls.sql`.

> **Rode somente no projeto Supabase de TESTE (ArenaIntinerante-Testes).**
> Nunca no projeto principal. Nunca com `service_role` ou chaves secretas.

| Arquivo | O que testa | Onde roda |
|---|---|---|
| `rls.api.test.mjs` | Comportamento real pela API (login anônimo, REST, upsert, RETURNING) | Terminal, Node 24, sem dependências |
| `rls.sql.test.sql` | Regras no banco com login simulado (C0 + T1–T19), inclusive T15, T16 e T19 | SQL Editor do projeto de teste; nada é gravado |

## Resultados (2026-11-08)

Executados no projeto **ArenaIntinerante-Testes** (`vacdiqjcvmfbmegiibat`), depois das migrações `0001_esquema.sql`, `0002_rls.sql` e `0003_privilegios.sql`. O projeto principal não foi acessado.

| Suíte | Aprovados | Reprovados | Não executados |
|---|---|---|---|
| API (`rls.api.test.mjs`): T1–T18, T4b, T7b–T7d, T9b, T9c, T12b e EXTRA | **25/25** | 0 | 0 |
| SQL (`rls.sql.test.sql`): C0 + T1–T19, com T4b e T9c | **56/56** verificações | 0 | 0 |

- **Rollback do SQL confirmado** pelo relatório da própria execução ("Nenhum dado foi gravado").
- **Falha encontrada e corrigida durante os testes:** o T4 da API reprovou porque `authenticated` tinha INSERT, UPDATE e DELETE de **tabela inteira** em `participantes`, `checkins` e `feedbacks`, além do modelo da 0002. A migração `0003_privilegios.sql` removeu o excesso; depois dela, todos os testes passaram.
- **Dados de teste da API** continuam no projeto de teste, aguardando limpeza manual por id (seção 7).

## 1. Preparação do projeto de teste (manual, uma vez)

1. Criar o projeto **ArenaIntinerante-Testes**.
2. Em Authentication, ativar o **login anônimo** e manter o **CAPTCHA desligado** (o script não envia captcha).
3. Executar `supabase/migrations/0001_esquema.sql` e depois `0002_rls.sql` no SQL Editor desse projeto.
4. Em Authentication → Users → **Add user**, criar dois usuários **permanentes** com e-mail e senha, já confirmados:
   - **P**: fica **fora** da equipe;
   - **E**: será da equipe.
5. No SQL Editor **do projeto de teste**, cadastrar **somente E** na equipe:
   ```sql
   insert into public.membros_equipe (user_id) values ('<id do usuário E>');
   ```

Os usuários **A** e **B** (e **A2**, **B2** no T2) são criados pelo próprio script a cada execução, pelo **login anônimo da API pública** (`POST /auth/v1/signup`, a mesma chamada de `supabase.auth.signInAnonymously()`). O script nunca usa a API administrativa (`/auth/v1/admin/*`). O usuário **X** (anônimo cadastrado por engano na equipe) existe só nos testes SQL.

## 2. Referências fixas no script (obrigatório; já preenchidas)

A proteção contra o projeto principal **não depende do `.env`**. No topo de `rls.api.test.mjs` existem duas constantes que precisam ser preenchidas **no código**:

| Constante | Valor |
|---|---|
| `REFERENCIA_PROJETO_TESTE` | referência do projeto **ArenaIntinerante-Testes** (o único que o script aceita contatar) |
| `REFERENCIAS_BLOQUEADAS` | lista com a referência do projeto **principal** (ArenaIntinerante), e de qualquer outro que nunca deva ser contatado |

**Enquanto alguma delas estiver vazia, o script se recusa a rodar.**

**Como obter cada referência com segurança:**
1. No painel do Supabase, **abra o projeto certo** e confira o **nome** no topo da página.
2. Vá em **Project Settings → General** e copie o **Project ID** (20 letras e números).
3. Confirme que é o mesmo trecho que aparece em **Project Settings → Data API → Project URL**: `https://<referência>.supabase.co`.
4. Faça isso **separadamente** para o projeto de teste e para o principal, e confira o nome do projeto **antes** de copiar.

A referência não é segredo (ela aparece na URL pública do projeto), então pode ficar no código versionado.

**Camadas de proteção:**
- **Antes de qualquer conexão:** as duas constantes precisam estar preenchidas e serem diferentes. A URL do `.env` precisa ser **exatamente** `https://<REFERENCIA_PROJETO_TESTE>.supabase.co`. Uma chave `sb_secret_` ou `service_role` encerra a execução.
- **Um único ponto de rede** (`requisitar`): só aceita caminhos de uma lista fechada (`/auth/v1/signup`, `/auth/v1/token?grant_type=password`, as 4 tabelas e `/rest/v1/rpc/eh_equipe`). Revalida o destino a cada requisição e não segue redirecionamentos.
- **Após cada login:** o emissor do token (`iss`) precisa ser o projeto de teste. Se não for, tudo é bloqueado.

## 3. Arquivo de credenciais (`.env.test.local`)

Crie o arquivo **na raiz do projeto**, você mesmo. Ele termina em `.local` e já é ignorado pelo `.gitignore`. Confirme antes do primeiro uso:

```bash
git check-ignore -v .env.test.local
```

Variáveis (só os nomes aqui; **não** coloque valores neste README, no chat ou no git):

| Variável | Conteúdo |
|---|---|
| `ARENA_TEST_SUPABASE_URL` | `https://<referência-de-teste>.supabase.co`, exatamente isso |
| `ARENA_TEST_SUPABASE_PUBLISHABLE_KEY` | publishable key **do projeto de teste** (`sb_publishable_...`) |
| `ARENA_TEST_P_EMAIL`, `ARENA_TEST_P_PASSWORD` | login de P |
| `ARENA_TEST_E_EMAIL`, `ARENA_TEST_E_PASSWORD` | login de E |

Sugestão: `chmod 600 .env.test.local`.

**Segredos fora da saída:** chave, senhas, e-mails e tokens (inclusive nas formas codificadas para URL e JSON) são substituídos por `***` em tudo o que o script imprime. Tokens ficam só em memória. Os ids dos usuários de teste **são** impressos, porque servem para a limpeza (seção 7).

## 4. Como executar a API

Suíte completa:

```bash
node --env-file=.env.test.local --test supabase/tests/rls.api.test.mjs
```

Um teste só (use `^` e o espaço depois do nome para não pegar T7b, T7c… junto com T7):

```bash
node --env-file=.env.test.local --test --test-name-pattern="^T7d " supabase/tests/rls.api.test.mjs
```

### Como ler o resultado

| Resultado | Quando acontece |
|---|---|
| **pass** (aprovado) | o comportamento foi exatamente o esperado |
| **fail** (reprovado) | **falha real**: um bloqueio não aconteceu, aconteceu do jeito errado **ou uma operação legítima foi recusada** (ex.: A não consegue criar o próprio check-in) |
| **skip — "NÃO EXECUTADO (ambiente)"** | só problemas de ambiente: credenciais de P/E ausentes; P/E sem a preparação manual; login anônimo desativado; limite de logins (HTTP 429); falha de rede |

No fim, o script imprime um **RESUMO**. **Aprovação exige 0 reprovados e 0 não executados.** T15 e T19 aparecem como skip porque são testados só no SQL.

**Casos especiais da preparação de P e E:**
- se P ou E **enxergarem linhas de outros membros** em `membros_equipe`, é **falha de segurança** (reprova);
- se E **não** enxergar a própria linha, é tratado como ambiente (skip). Se E estiver mesmo cadastrado, rode o T13 do SQL: pode ser falha de RLS.

## 5. Testes, dependências e efeitos (API)

Cada teste cria os próprios check-ins (estação `rls-<execução>-<teste>`), então pode rodar sozinho. A e B são criados uma vez por execução e reaproveitados pelos testes dessa execução.

**Tipos de bloqueio conferidos:**
- **sem permissão (GRANT)**: `42501`, `permission denied for table …` (HTTP 403; 401 sem login);
- **violação de política (WITH CHECK)**: `42501`, `new row violates row-level security policy …` (HTTP 403);
- **zero linhas (USING)**: sem erro, HTTP 200 com `[]`, e o **dono** relê a linha para confirmar que nada mudou;
- **trigger**: `P0001` com `hint` (HTTP 400).

| Teste | Usuários | Preparação própria | Esperado |
|---|---|---|---|
| T1 | sem login | — | permissão negada nas 4 tabelas |
| T2 | A2, B2 (novos) | — | cadastro próprio ok; com id de B2 → violação de política; B2 segue sem cadastro |
| T3 | A, B | cadastros | A vê 1 linha (a dele) |
| T4 | A | cadastro | apelido ok (+`atualizado_em`); `id`/`criado_em` → sem permissão; valores inalterados |
| **T4b** | A, B | cadastros | A altera cadastro de B → `[]`; **B confirma** apelido e `atualizado_em` intactos |
| T5 | A, B | cadastros | check-in na fila ok; em nome de B → política; com `status` → sem permissão |
| T6 | A | 1 check-in | duplicado → 23505; "ignorar duplicados" → `[]`; continua 1 |
| T7 | A | 1 check-in | conclui; `concluido_em` preenchido |
| T7b | A | check-in concluído | `[]`; `concluido_em` inalterado |
| T7c | A | check-in na fila | `status: na_fila` → política; continua na fila |
| T7d | A, B | check-in de B **na fila** | `[]`; B confirma que continua na fila |
| T8 | A, B | 2 de A (fila, concluído) e 1 de B concluído | fila → trigger; concluído → ok; de B → **mesma** mensagem do trigger |
| T9 | A | 2 concluídos + avaliação | nota ok (+`atualizado_em`); `checkin_id` → sem permissão |
| T9b | A | concluído + avaliação nota 2 | upsert com `SET checkin_id` → sem permissão; nota continua 2 |
| **T9c** | A, B | avaliação de B | A altera avaliação de B → `[]`; **B confirma** nota, comentário e `atualizado_em` intactos |
| T10 | A, B (E opcional) | linhas de A e B | todos os DELETE → sem permissão; donos releem as mesmas linhas pelos ids |
| T11 | A, B | dados de A e um check-in de B | **controle**: B vê o próprio cadastro e check-in; nada de A |
| T12 | A, **E** | E na equipe | A lê `membros_equipe` → `[]` |
| T12b | A | — | A se cadastra na equipe → sem permissão |
| T13 | **E** | E na equipe | 1 linha, a de E (o caso com vários membros é provado no SQL) |
| T14 | **E**, A | dados de A | E recebe `[]` nas 3 tabelas |
| T15 | — | — | **somente SQL** (aparece como skip) |
| T16 | A | — | `rpc/eh_equipe` → 404 `PGRST202` (a permissão é provada no SQL) |
| T17 | A | — | datas pelo servidor; avaliação de check-in na fila → trigger |
| T18 | A, B | 1 de A e 1 de B, **ambos na fila na mesma estação** (conferido antes) | PATCH filtrado devolve **só** o de A; o de B continua na fila |
| T19 | — | — | **somente SQL** (aparece como skip) |
| **T20** | C (novo) | — | Fluxo de cadastro do app (`identidadeSupabase.ts`): SELECT da própria linha → `[]`; INSERT com `id = auth.uid()` → 201; INSERT repetido → 23505; UPDATE de apelido/cidade/idade → 1 linha com `atualizado_em`; `id` e `criado_em` inalterados. **Preparado em 2026-11-08, ainda não executado** |
| **T21** | D (novo) | cadastro de D | Fluxo de `checkinsSupabase.registrarCheckin`: cadastro existe; INSERT `{arena_id, estacao}` → 201 (dono = `auth.uid()`, `na_fila`); INSERT repetido → 23505; busca por participante + arena + estação → **1** linha, o mesmo check-in. **Preparado, não executado** |
| **T22** | A, B | 1 check-in de A e 1 de B, na fila | Fluxo de `concluirCheckin`: PATCH próprio → 1 linha com `concluido_em`; repetido → `[]` e a releitura devolve o concluído com `concluido_em` inalterado; PATCH no check-in de B → `[]`, invisível para A, e B confirma "na fila". **Preparado, não executado** |
| **T23** | F (novo) | — | Check-in **sem cadastro**: verificação do app → `[]`; INSERT → 409 `23503` (chave estrangeira); nenhum check-in criado. **Preparado, não executado** |
| **T24** | A | 1 check-in de A **concluído** | Fluxo de `feedbackSupabase.salvarFeedback`: check-in concluído confirmado; SELECT da avaliação → `[]`; INSERT `{checkin_id, nota, comentario}` → 201 (dono = `auth.uid()`, `atualizado_em` vazio); INSERT repetido → 23505; UPDATE de `nota` e `comentario` (inclusive para `null`) → 1 linha com `atualizado_em`; continua 1 avaliação, com `checkin_id` e `criado_em` inalterados. **Preparado, não executado** |
| EXTRA | A, **P**, **E** | P fora e E dentro da equipe | `is_anonymous`: A = true; P e E = false |

**Limite de logins anônimos:** a suíte completa cria 7 usuários anônimos (A, B, A2, B2, C do T20, D do T21 e F do T23). O padrão do Supabase é 30 por hora por IP.

## 6. Testes SQL (`rls.sql.test.sql`)

- O arquivo inteiro é **um único bloco `DO`**, portanto **um único comando atômico**.
- Selecionar só um trecho não executa nada: o trecho fica incompleto e o PostgreSQL recusa.
- O bloco termina com um **erro proposital** contendo o relatório. O erro desfaz **tudo** (usuários temporários e linhas). Um erro inesperado também desfaz tudo.

**Como rodar:**
1. Abra o SQL Editor **do projeto de teste**, com o papel **postgres** (sem "impersonate").
2. Cole o arquivo inteiro e clique em **Run**. Se o editor pedir confirmação por haver `delete`/`update`, confirme: tudo será desfeito.
3. O resultado aparece como **ERRO** com o texto `RELATÓRIO RLS: N passaram, M falharam…`. **Isso é esperado.**

**Rodar só alguns testes:** edite a linha `v_selecao text[] := '{}';` no topo, por exemplo `'{T4b,T9c}'`. A preparação comum e o controle **C0** rodam sempre. Cada teste cria os próprios dados e **não depende de nenhum outro**. O T15 remove E da equipe e o **restaura** no fim. Nome desconhecido em `v_selecao` interrompe a execução.

**Troca de papel:**
- Cada teste simula o usuário com `set local role` + `request.jwt.claims`.
- **Antes** de testar, confere `current_user` e `auth.uid()`; **depois**, confere que o papel original voltou. Se alguma conferência falhar, a execução inteira é abortada.
- O **C0** prova que a simulação isola os dados: o `postgres` vê 2 cadastros e o A simulado vê 1. Se não, aborta.
- Toda verificação de "nada mudou" é feita depois de voltar ao `postgres`, que enxerga tudo.

**Testes:** C0, T1, T2, T3, T4, **T4b**, T5, T6, T7, T7b, T7c, T7d, T8, T9, T9b, **T9c**, T10, T11, T12, T13, T14, T15, T16, T17, T18, T19.

## 7. Limpeza dos dados de teste da API

- **Não existe comando de limpeza automática**, de propósito. Excluir "todos os anônimos" apagaria participantes reais se fosse rodado no projeto errado.
- Os dados criados pela API ficam só no **projeto de teste**. Para identificá-los com segurança, o script imprime no fim:
  - os **ids exatos** dos usuários anônimos criados naquela execução;
  - o prefixo das estações usadas (`rls-<execução>-*`).
- Para remover, **no painel do projeto de teste** (confira o nome do projeto), vá em Authentication → Users, procure **cada id impresso** e exclua o usuário. Os cadastros, check-ins e avaliações dele são apagados em cascata.
- Alternativa: recriar o projeto de teste.
- Os testes SQL não deixam dados (tudo é desfeito).

## 8. Limitações

- **Referências fixas:** a API só roda com `REFERENCIA_PROJETO_TESTE` e `REFERENCIAS_BLOQUEADAS` preenchidas (seção 2). Se o projeto de teste for recriado, a referência precisa ser atualizada no script.
- **SQL:**
  - o login é simulado (não há token assinado nem API);
  - `now()` é igual em toda a transação, então as datas são conferidas só como preenchidas e em ordem (`>=`);
  - a inserção em `auth.users` depende da versão do Supabase: se for recusada, nada é gravado e a execução para no início;
  - o relatório aparece como erro no editor.
- **API:**
  - X não é testado pela API (só faria diferença na `resumo_painel()`, etapa S3);
  - o T16 pela API prova só que a função não está exposta;
  - o T13 pela API não prova "só a própria linha" quando E é o único membro (o T12 da API e o T13 do SQL cobrem esse caso).
- **Não testado (fora do escopo de RLS):**
  - o INSERT de avaliação em nome de outra pessoa é barrado pelo trigger **antes** da política `WITH CHECK`, que fica como camada extra sem teste próprio;
  - UPDATE de `cidade`/`idade`;
  - limites de tamanho (CHECK);
  - upsert de sucesso em `participantes` (etapa S5).
- **Códigos e mensagens:** os HTTP e as mensagens esperados foram confirmados na execução de 2026-11-08. Uma atualização do Supabase/PostgREST pode alterá-los; nesse caso o teste reprova (não passa por engano).
- **Lint:** o `expo lint` pode analisar estes arquivos; ainda não foi executado.

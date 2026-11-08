/**
 * ArenaIntinerante — testes de segurança RLS pela API (T1–T19).
 *
 * Executa SOMENTE contra o projeto Supabase de TESTE (ArenaIntinerante-Testes),
 * usando apenas a publishable key. Nunca usa service_role nem a API administrativa.
 *
 * ANTES DO PRIMEIRO USO: preencher REFERENCIA_PROJETO_TESTE e
 * REFERENCIAS_BLOQUEADAS (seção 1). Enquanto estiverem vazias, o script
 * se recusa a rodar. Ver supabase/tests/README.md, seção 2.
 *
 * Execução (Node 24, sem dependências):
 *   node --env-file=.env.test.local --test supabase/tests/rls.api.test.mjs
 * Um teste só (ex.: T7d):
 *   node --env-file=.env.test.local --test --test-name-pattern="^T7d " supabase/tests/rls.api.test.mjs
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// =====================================================================
// 1. Projetos permitidos e bloqueados (FIXOS no código, não no .env)
// =====================================================================

/**
 * PENDENTE: referência (Project ID) do projeto ArenaIntinerante-TESTES.
 * É o ÚNICO projeto que este script aceita contatar.
 */
const REFERENCIA_PROJETO_TESTE = 'vacdiqjcvmfbmegiibat';

/**
 * PENDENTE: referência(s) do(s) projeto(s) que NUNCA podem ser contatados
 * (no mínimo, o projeto principal ArenaIntinerante).
 */
const REFERENCIAS_BLOQUEADAS = ['gdvshuohrfqyzeublxmz'];

// =====================================================================
// 2. Proteções: tudo validado ANTES de qualquer conexão
// =====================================================================

/** Configuração insegura ou destino errado: bloqueia toda a execução. */
class ErroDeConfiguracao extends Error {}
/** Problema de ambiente/preparação manual (não é falha de segurança): teste NÃO EXECUTADO. */
class FalhaDeAmbiente extends Error {}

/** Valores que nunca podem aparecer na saída (e suas formas codificadas). */
const SEGREDOS = new Set();
let BLOQUEADO = false;

function protegerSegredo(valor) {
  if (!valor || String(valor).length < 4) return;
  const texto = String(valor);
  SEGREDOS.add(texto);
  SEGREDOS.add(encodeURIComponent(texto));
  SEGREDOS.add(JSON.stringify(texto).slice(1, -1));
}

function ocultar(valor) {
  let texto = String(valor);
  const ordenados = [...SEGREDOS].sort((x, y) => y.length - x.length);
  for (const segredo of ordenados) texto = texto.split(segredo).join('***');
  return texto;
}

/** Único ponto de impressão: sempre passa por ocultar(). */
function registrar(mensagem) {
  console.log(ocultar(mensagem));
}

/** Lê o payload de um JWT localmente (sem rede, sem validar assinatura). */
function decodificarJwt(token) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const FORMATO_REF = /^[a-z0-9]{20}$/;

function lerConfiguracao(env) {
  const falhar = (mensagem) => {
    throw new ErroDeConfiguracao(`[configuração] ${mensagem}`);
  };

  // Segredos registrados antes de qualquer validação que possa imprimir algo.
  for (const nome of [
    'ARENA_TEST_SUPABASE_PUBLISHABLE_KEY',
    'ARENA_TEST_P_EMAIL',
    'ARENA_TEST_P_PASSWORD',
    'ARENA_TEST_E_EMAIL',
    'ARENA_TEST_E_PASSWORD',
  ]) {
    protegerSegredo(env[nome]);
  }

  // Constantes do código (independentes do .env).
  if (!FORMATO_REF.test(REFERENCIA_PROJETO_TESTE)) {
    falhar('PENDENTE: preencha REFERENCIA_PROJETO_TESTE no script (ver README, seção 2).');
  }
  if (!Array.isArray(REFERENCIAS_BLOQUEADAS) || REFERENCIAS_BLOQUEADAS.length === 0) {
    falhar('PENDENTE: preencha REFERENCIAS_BLOQUEADAS com o projeto principal (ver README, seção 2).');
  }
  if (!REFERENCIAS_BLOQUEADAS.every((ref) => FORMATO_REF.test(ref))) {
    falhar('REFERENCIAS_BLOQUEADAS contém valor em formato inválido.');
  }
  if (REFERENCIAS_BLOQUEADAS.includes(REFERENCIA_PROJETO_TESTE)) {
    falhar('O projeto de teste está na lista de bloqueados. Execução bloqueada.');
  }

  // URL do .env precisa coincidir EXATAMENTE com a constante do código.
  const hostEsperado = `${REFERENCIA_PROJETO_TESTE}.supabase.co`;
  let base;
  try {
    base = new URL(env.ARENA_TEST_SUPABASE_URL ?? '');
  } catch {
    falhar('ARENA_TEST_SUPABASE_URL ausente ou inválida.');
  }
  const urlExata =
    base.protocol === 'https:' &&
    base.hostname === hostEsperado &&
    base.port === '' &&
    base.username === '' &&
    base.password === '' &&
    base.pathname === '/' &&
    base.search === '' &&
    base.hash === '';
  if (!urlExata) {
    falhar(`ARENA_TEST_SUPABASE_URL deve ser exatamente https://${hostEsperado}`);
  }
  if (REFERENCIAS_BLOQUEADAS.some((ref) => base.hostname.includes(ref))) {
    falhar('A URL aponta para um projeto bloqueado. Execução bloqueada.');
  }

  const chave = env.ARENA_TEST_SUPABASE_PUBLISHABLE_KEY ?? '';
  if (!chave) falhar('ARENA_TEST_SUPABASE_PUBLISHABLE_KEY ausente.');
  if (/sb_secret_/i.test(chave)) {
    falhar('Chave secreta detectada. Use SOMENTE a publishable key do projeto de teste.');
  }
  if (!chave.startsWith('sb_publishable_')) {
    const claims = decodificarJwt(chave);
    if (claims?.role === 'service_role') falhar('Chave service_role detectada. Execução bloqueada.');
    if (!claims || claims.role !== 'anon' || claims.ref !== REFERENCIA_PROJETO_TESTE) {
      falhar('A chave deve ser a publishable key (sb_publishable_...) ou a anon key legada DO PROJETO DE TESTE.');
    }
  }

  return {
    origem: base.origin,
    host: hostEsperado,
    emissorEsperado: `${base.origin}/auth/v1`,
    chave,
    p: { email: env.ARENA_TEST_P_EMAIL ?? '', senha: env.ARENA_TEST_P_PASSWORD ?? '' },
    e: { email: env.ARENA_TEST_E_EMAIL ?? '', senha: env.ARENA_TEST_E_PASSWORD ?? '' },
  };
}

// Falha aqui (no carregamento) impede o registro de qualquer teste e qualquer requisição.
const CONFIG = lerConfiguracao(process.env);
const EXECUCAO = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
registrar(`Projeto alvo: ${REFERENCIA_PROJETO_TESTE} | execução: ${EXECUCAO}`);

function garantirProjetoDeTeste(url) {
  const ok =
    url.protocol === 'https:' &&
    url.origin === CONFIG.origem &&
    url.hostname === CONFIG.host &&
    url.hostname === `${REFERENCIA_PROJETO_TESTE}.supabase.co` &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    !REFERENCIAS_BLOQUEADAS.some((ref) => url.hostname.includes(ref));
  if (!ok) {
    BLOQUEADO = true;
    throw new ErroDeConfiguracao('Requisição bloqueada: destino diferente do projeto de teste.');
  }
}

/** Únicos caminhos permitidos. Qualquer outro (inclusive /auth/v1/admin) é recusado. */
const CAMINHOS_PERMITIDOS = [
  /^\/auth\/v1\/signup$/,
  /^\/auth\/v1\/token$/,
  /^\/rest\/v1\/(participantes|checkins|feedbacks|membros_equipe)$/,
  /^\/rest\/v1\/rpc\/eh_equipe$/,
];

/** ÚNICO ponto de rede do script. Valida caminho e destino ANTES de cada requisição. */
async function requisitar(caminho, { metodo = 'GET', token = null, corpo, prefer, consulta = {} } = {}) {
  if (BLOQUEADO) throw new ErroDeConfiguracao('Execução bloqueada por uma falha de segurança anterior.');
  if (
    typeof caminho !== 'string' ||
    !caminho.startsWith('/') ||
    caminho.startsWith('//') ||
    /[?#\\]|:\/\//.test(caminho)
  ) {
    throw new ErroDeConfiguracao('Caminho de requisição inválido.');
  }
  if (!CAMINHOS_PERMITIDOS.some((regra) => regra.test(caminho))) {
    throw new ErroDeConfiguracao(`Caminho não permitido: ${caminho}`);
  }

  const url = new URL(caminho, CONFIG.origem);
  for (const [nome, valor] of Object.entries(consulta)) url.searchParams.set(nome, valor);
  if (caminho === '/auth/v1/token' && url.searchParams.get('grant_type') !== 'password') {
    throw new ErroDeConfiguracao('Somente grant_type=password é permitido em /auth/v1/token.');
  }
  garantirProjetoDeTeste(url);

  const cabecalhos = { apikey: CONFIG.chave, Accept: 'application/json' };
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (prefer) cabecalhos.Prefer = prefer;

  let resposta;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: cabecalhos,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // Não imprime a requisição nem a causa (podem conter cabeçalhos).
    throw new FalhaDeAmbiente(`Falha de rede em ${metodo} ${caminho}.`);
  }

  const texto = await resposta.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }
  return { status: resposta.status, dados };
}

/** Resumo seguro de uma resposta de erro (sem details, que pode conter valores). */
function resumo(r) {
  return `HTTP ${r.status}${r.dados?.code ? `, ${r.dados.code}` : ''}`;
}

// =====================================================================
// 3. Autenticação (sem service_role e sem API administrativa)
// =====================================================================

const USUARIOS_CRIADOS = [];

function conferirToken(token, rotulo, idEsperado, anonimoEsperado) {
  const claims = decodificarJwt(token);
  if (!claims) throw new FalhaDeAmbiente(`Token de ${rotulo} ilegível.`);
  if (claims.iss !== CONFIG.emissorEsperado) {
    BLOQUEADO = true;
    throw new ErroDeConfiguracao(`Token de ${rotulo} emitido por outro projeto. Execução bloqueada.`);
  }
  if (claims.role !== 'authenticated' || claims.sub !== idEsperado) {
    throw new FalhaDeAmbiente(`Token de ${rotulo} com papel ou usuário inesperado.`);
  }
  if (claims.is_anonymous !== anonimoEsperado) {
    throw new FalhaDeAmbiente(`Token de ${rotulo}: is_anonymous deveria ser ${anonimoEsperado}.`);
  }
  return claims;
}

/** Login anônimo pela API pública (mesma chamada de supabase.auth.signInAnonymously()). */
async function criarAnonimo(rotulo) {
  const r = await requisitar('/auth/v1/signup', { metodo: 'POST', corpo: { data: {} } });
  if (r.status === 429) {
    throw new FalhaDeAmbiente('Limite de logins anônimos atingido (HTTP 429). Aguarde e tente de novo.');
  }
  const token = r.dados?.access_token;
  const id = r.dados?.user?.id;
  if (r.status !== 200 || !token || !id) {
    const codigo = r.dados?.error_code ?? r.dados?.code ?? '';
    throw new FalhaDeAmbiente(
      `Login anônimo de ${rotulo} falhou (HTTP ${r.status}${codigo ? `, ${codigo}` : ''}). ` +
        'Confira se o login anônimo está ativo e o CAPTCHA desligado no projeto de teste.'
    );
  }
  protegerSegredo(token);
  protegerSegredo(r.dados.refresh_token);
  if (r.dados.user.is_anonymous !== true) {
    throw new FalhaDeAmbiente(`Usuário ${rotulo} não foi criado como anônimo.`);
  }
  conferirToken(token, rotulo, id, true);
  USUARIOS_CRIADOS.push({ rotulo, id });
  return { rotulo, id, token };
}

/** Login por senha de um usuário permanente criado MANUALMENTE no painel do projeto de teste. */
async function entrarComSenha(rotulo, credenciais) {
  if (!credenciais.email || !credenciais.senha) {
    throw new FalhaDeAmbiente(`Credenciais de ${rotulo} não configuradas no .env.test.local.`);
  }
  const r = await requisitar('/auth/v1/token', {
    metodo: 'POST',
    consulta: { grant_type: 'password' },
    corpo: { email: credenciais.email, password: credenciais.senha },
  });
  const token = r.dados?.access_token;
  const id = r.dados?.user?.id;
  if (r.status !== 200 || !token || !id) {
    throw new FalhaDeAmbiente(`Login de ${rotulo} falhou (HTTP ${r.status}). Confira o usuário no projeto de teste.`);
  }
  protegerSegredo(token);
  protegerSegredo(r.dados.refresh_token);
  conferirToken(token, rotulo, id, false);
  return { rotulo, id, token };
}

// =====================================================================
// 4. Preparação reutilizável (memorizada por execução)
//    Operação LEGÍTIMA recusada => REPROVA (assert). Só ambiente => skip.
// =====================================================================

const memoria = new Map();
function umaVez(chave, fabrica) {
  if (!memoria.has(chave)) memoria.set(chave, fabrica());
  return memoria.get(chave);
}

/** Anônimo com cadastro em participantes (A ou B). */
function participante(rotulo) {
  return umaVez(`participante:${rotulo}`, async () => {
    const usuario = await criarAnonimo(rotulo);
    const r = await requisitar('/rest/v1/participantes', {
      metodo: 'POST',
      token: usuario.token,
      corpo: { apelido: `Teste ${rotulo}`, cidade: 'Teste', idade: 20 },
      prefer: 'return=representation',
    });
    assert.equal(r.status, 201, `preparação: cadastro de ${rotulo} recusado (${resumo(r)})`);
    assert.equal(r.dados?.[0]?.id, usuario.id, `preparação: cadastro de ${rotulo} com id errado`);
    return usuario;
  });
}
const usuarioA = () => participante('A');
const usuarioB = () => participante('B');

/**
 * Lê membros_equipe como um usuário permanente e separa:
 * - linhas de OUTROS usuários => falha de SEGURANÇA (reprova);
 * - ausência/presença da própria linha => depende da preparação manual.
 */
async function linhaPropriaNaEquipe(usuario) {
  const r = await requisitar('/rest/v1/membros_equipe', { token: usuario.token, consulta: { select: 'user_id' } });
  assert.equal(r.status, 200, `membros_equipe lida por ${usuario.rotulo}: ${resumo(r)}`);
  assert.ok(Array.isArray(r.dados), `membros_equipe lida por ${usuario.rotulo}: resposta em lista`);
  assert.ok(
    r.dados.every((linha) => linha.user_id === usuario.id),
    `SEGURANÇA: ${usuario.rotulo} enxerga linhas de outros membros em membros_equipe`
  );
  return r.dados.length === 1;
}

/** E: permanente e cadastrado em membros_equipe (preparação manual). */
function usuarioE() {
  return umaVez('E', async () => {
    const usuario = await entrarComSenha('E', CONFIG.e);
    if (!(await linhaPropriaNaEquipe(usuario))) {
      throw new FalhaDeAmbiente(
        'E não aparece em membros_equipe. Confira o cadastro manual; se E estiver cadastrado, rode o T13 do SQL (pode ser falha de RLS).'
      );
    }
    return usuario;
  });
}

/** P: permanente e FORA de membros_equipe (preparação manual). */
function usuarioP() {
  return umaVez('P', async () => {
    const usuario = await entrarComSenha('P', CONFIG.p);
    if (await linhaPropriaNaEquipe(usuario)) {
      throw new FalhaDeAmbiente('P está cadastrado em membros_equipe; remova-o no projeto de teste.');
    }
    return usuario;
  });
}

const temEquipeConfigurada = () => Boolean(CONFIG.e.email && CONFIG.e.senha);

/** Nome de estação exclusivo desta execução e deste teste (identifica os dados). */
const estacao = (rotulo) => `rls-${EXECUCAO}-${rotulo}`;
const ARENA = 'rls-teste';

async function criarCheckin(usuario, rotulo, { concluir = false } = {}) {
  const r = await requisitar('/rest/v1/checkins', {
    metodo: 'POST',
    token: usuario.token,
    corpo: { arena_id: ARENA, estacao: estacao(rotulo) },
    prefer: 'return=representation',
  });
  assert.equal(r.status, 201, `preparação: check-in ${rotulo} de ${usuario.rotulo} recusado (${resumo(r)})`);
  let checkin = r.dados?.[0];
  assert.ok(checkin?.id, `preparação: check-in ${rotulo} sem id`);
  if (concluir) {
    const c = await requisitar('/rest/v1/checkins', {
      metodo: 'PATCH',
      token: usuario.token,
      consulta: { id: `eq.${checkin.id}` },
      corpo: { status: 'concluido' },
      prefer: 'return=representation',
    });
    assert.equal(c.status, 200, `preparação: conclusão de ${rotulo} recusada (${resumo(c)})`);
    assert.equal(c.dados?.[0]?.status, 'concluido', `preparação: ${rotulo} não ficou concluído`);
    checkin = c.dados[0];
  }
  return checkin;
}

async function criarAvaliacao(usuario, checkinId, nota = 4) {
  const r = await requisitar('/rest/v1/feedbacks', {
    metodo: 'POST',
    token: usuario.token,
    corpo: { checkin_id: checkinId, nota },
    prefer: 'return=representation',
  });
  assert.equal(r.status, 201, `preparação: avaliação de ${usuario.rotulo} recusada (${resumo(r)})`);
  assert.ok(r.dados?.[0]?.id, 'preparação: avaliação sem id');
  return r.dados[0];
}

async function lerPorId(usuario, tabela, id, coluna = 'id') {
  const r = await requisitar(`/rest/v1/${tabela}`, {
    token: usuario.token,
    consulta: { select: '*', [coluna]: `eq.${id}` },
  });
  assert.equal(r.status, 200, `leitura de ${tabela} por ${usuario.rotulo}: ${resumo(r)}`);
  assert.ok(Array.isArray(r.dados), `leitura de ${tabela}: resposta em lista`);
  return r.dados;
}

async function lerTudo(usuario, tabela) {
  const r = await requisitar(`/rest/v1/${tabela}`, { token: usuario.token, consulta: { select: '*' } });
  assert.equal(r.status, 200, `leitura de ${tabela} por ${usuario.rotulo}: ${resumo(r)}`);
  assert.ok(Array.isArray(r.dados), `leitura de ${tabela}: resposta em lista`);
  return r.dados;
}

// =====================================================================
// 5. Conferências dos três tipos de bloqueio
// =====================================================================

/** Tipo A — sem permissão (GRANT). */
function esperarSemPermissao(r, tabela, contexto, { anonimo = false } = {}) {
  assert.equal(r.status, anonimo ? 401 : 403, `${contexto}: HTTP`);
  assert.equal(r.dados?.code, '42501', `${contexto}: código`);
  assert.match(String(r.dados?.message ?? ''), new RegExp(`permission denied for table "?${tabela}"?`), `${contexto}: mensagem`);
}

/** Tipo B — violação de política (WITH CHECK). */
function esperarViolacaoDePolitica(r, tabela, contexto) {
  assert.equal(r.status, 403, `${contexto}: HTTP`);
  assert.equal(r.dados?.code, '42501', `${contexto}: código`);
  const mensagem = String(r.dados?.message ?? '');
  assert.match(mensagem, /new row violates row-level security policy/, `${contexto}: mensagem`);
  assert.ok(mensagem.includes(tabela), `${contexto}: tabela na mensagem`);
}

/** Tipo C — zero linhas (USING esconde a linha; sem erro). */
function esperarZeroLinhas(r, contexto) {
  assert.equal(r.status, 200, `${contexto}: HTTP`);
  assert.ok(Array.isArray(r.dados), `${contexto}: resposta em lista`);
  assert.equal(r.dados.length, 0, `${contexto}: linhas afetadas/devolvidas`);
}

/** Erro de trigger da 0001 (P0001 + hint). */
function esperarTrigger(r, hint, trecho, contexto) {
  assert.equal(r.status, 400, `${contexto}: HTTP`);
  assert.equal(r.dados?.code, 'P0001', `${contexto}: código`);
  assert.equal(r.dados?.hint, hint, `${contexto}: hint`);
  assert.ok(String(r.dados?.message ?? '').includes(trecho), `${contexto}: mensagem`);
}

// =====================================================================
// 6. Registro dos testes e resumo
// =====================================================================

const placar = { aprovados: 0, reprovados: 0, naoExecutados: 0 };

/**
 * FalhaDeAmbiente => NÃO EXECUTADO (skip).
 * Qualquer outra exceção (inclusive operação legítima recusada) => REPROVADO.
 */
function caso(nome, funcao) {
  test(nome, async (contexto) => {
    try {
      await funcao(contexto);
      placar.aprovados += 1;
    } catch (erro) {
      if (erro instanceof FalhaDeAmbiente) {
        placar.naoExecutados += 1;
        contexto.skip(`NÃO EXECUTADO (ambiente) — ${ocultar(erro.message)}`);
        return;
      }
      placar.reprovados += 1;
      throw erro;
    }
  });
}

after(() => {
  registrar('------------------------------------------------------------');
  registrar(
    `RESUMO: aprovados=${placar.aprovados} reprovados=${placar.reprovados} ` +
      `não executados=${placar.naoExecutados} (T15 e T19 são somente SQL)`
  );
  registrar(
    placar.reprovados === 0 && placar.naoExecutados === 0 && placar.aprovados > 0
      ? 'APROVAÇÃO: todos os testes executados passaram.'
      : 'SEM APROVAÇÃO: é preciso 0 reprovados e 0 não executados.'
  );
  if (USUARIOS_CRIADOS.length > 0) {
    registrar(`Usuários anônimos criados nesta execução (projeto de teste): ${USUARIOS_CRIADOS.map((u) => `${u.rotulo}=${u.id}`).join(' ')}`);
    registrar(`Dados criados usam a estação "rls-${EXECUCAO}-*". Limpeza: ver README, seção 7.`);
  }
});

// =====================================================================
// 7. Testes
// =====================================================================

caso('T1 anon não lê nenhuma tabela', async () => {
  for (const tabela of ['participantes', 'checkins', 'feedbacks', 'membros_equipe']) {
    const r = await requisitar(`/rest/v1/${tabela}`, { consulta: { select: '*' } });
    esperarSemPermissao(r, tabela, `T1 ${tabela}`, { anonimo: true });
    assert.ok(!Array.isArray(r.dados), `T1 ${tabela}: não pode devolver lista`);
  }
});

caso('T2 cadastro só para si', async () => {
  // Usuários exclusivos: B2 ainda não tem cadastro.
  const a2 = await criarAnonimo('A2');
  const b2 = await criarAnonimo('B2');

  const proprio = await requisitar('/rest/v1/participantes', {
    metodo: 'POST',
    token: a2.token,
    corpo: { apelido: 'Teste A2', cidade: 'Teste', idade: 20 },
    prefer: 'return=representation',
  });
  assert.equal(proprio.status, 201, 'T2 próprio: HTTP');
  assert.equal(proprio.dados?.[0]?.id, a2.id, 'T2 próprio: id = A2');

  esperarViolacaoDePolitica(
    await requisitar('/rest/v1/participantes', {
      metodo: 'POST',
      token: a2.token,
      corpo: { id: b2.id, apelido: 'Invasor', cidade: 'Teste', idade: 20 },
      prefer: 'return=representation',
    }),
    'participantes',
    'T2 com id de B2'
  );

  esperarZeroLinhas(
    await requisitar('/rest/v1/participantes', { token: b2.token, consulta: { select: '*' } }),
    'T2 B2 continua sem cadastro'
  );
});

caso('T3 lê só o próprio cadastro', async () => {
  const a = await usuarioA();
  await usuarioB(); // garante um segundo cadastro existente
  const linhas = await lerTudo(a, 'participantes');
  assert.equal(linhas.length, 1, 'T3: quantidade');
  assert.equal(linhas[0].id, a.id, 'T3: id');
});

caso('T4 altera só campos permitidos do próprio cadastro', async () => {
  const a = await usuarioA();
  const [antes] = await lerPorId(a, 'participantes', a.id);

  const ok = await requisitar('/rest/v1/participantes', {
    metodo: 'PATCH',
    token: a.token,
    consulta: { id: `eq.${a.id}` },
    corpo: { apelido: 'T4 ok' },
    prefer: 'return=representation',
  });
  assert.equal(ok.status, 200, 'T4 apelido: HTTP');
  assert.equal(ok.dados?.length, 1, 'T4 apelido: 1 linha');
  assert.equal(ok.dados[0].apelido, 'T4 ok', 'T4 apelido: valor');
  assert.ok(ok.dados[0].atualizado_em, 'T4 apelido: atualizado_em preenchido (trigger)');

  for (const [campo, valor] of [
    ['id', randomUUID()],
    ['criado_em', '2000-01-01T00:00:00Z'],
  ]) {
    esperarSemPermissao(
      await requisitar('/rest/v1/participantes', {
        metodo: 'PATCH',
        token: a.token,
        consulta: { id: `eq.${a.id}` },
        corpo: { [campo]: valor },
        prefer: 'return=representation',
      }),
      'participantes',
      `T4 ${campo}`
    );
  }

  const [depois] = await lerPorId(a, 'participantes', a.id);
  assert.equal(depois.id, antes.id, 'T4: id inalterado');
  assert.equal(depois.criado_em, antes.criado_em, 'T4: criado_em inalterado');
});

caso('T4b não altera o cadastro de outra pessoa', async () => {
  const a = await usuarioA();
  const b = await usuarioB();
  const [antes] = await lerPorId(b, 'participantes', b.id);
  assert.ok(antes, 'T4b: B tem cadastro');

  esperarZeroLinhas(
    await requisitar('/rest/v1/participantes', {
      metodo: 'PATCH',
      token: a.token,
      consulta: { id: `eq.${b.id}` },
      corpo: { apelido: 'Invasor' },
      prefer: 'return=representation',
    }),
    'T4b'
  );

  const [depois] = await lerPorId(b, 'participantes', b.id);
  assert.equal(depois.apelido, antes.apelido, 'T4b: B confirma apelido inalterado');
  assert.equal(depois.atualizado_em, antes.atualizado_em, 'T4b: B confirma atualizado_em inalterado');
});

caso('T5 check-in só para si e sempre na fila', async () => {
  const a = await usuarioA();
  const b = await usuarioB();

  const ok = await requisitar('/rest/v1/checkins', {
    metodo: 'POST',
    token: a.token,
    corpo: { arena_id: ARENA, estacao: estacao('T5') },
    prefer: 'return=representation',
  });
  assert.equal(ok.status, 201, 'T5 próprio: HTTP');
  const linha = ok.dados?.[0];
  assert.equal(linha?.participante_id, a.id, 'T5 próprio: dono');
  assert.equal(linha?.status, 'na_fila', 'T5 próprio: status');
  assert.equal(linha?.concluido_em, null, 'T5 próprio: concluido_em');

  esperarViolacaoDePolitica(
    await requisitar('/rest/v1/checkins', {
      metodo: 'POST',
      token: a.token,
      corpo: { participante_id: b.id, arena_id: ARENA, estacao: estacao('T5-B') },
      prefer: 'return=representation',
    }),
    'checkins',
    'T5 em nome de B'
  );
  esperarSemPermissao(
    await requisitar('/rest/v1/checkins', {
      metodo: 'POST',
      token: a.token,
      corpo: { arena_id: ARENA, estacao: estacao('T5-status'), status: 'concluido' },
      prefer: 'return=representation',
    }),
    'checkins',
    'T5 informando status'
  );
});

caso('T6 sem check-in duplicado', async () => {
  const a = await usuarioA();
  await criarCheckin(a, 'T6');

  const duplicado = await requisitar('/rest/v1/checkins', {
    metodo: 'POST',
    token: a.token,
    corpo: { arena_id: ARENA, estacao: estacao('T6') },
    prefer: 'return=representation',
  });
  assert.equal(duplicado.status, 409, 'T6 duplicado: HTTP');
  assert.equal(duplicado.dados?.code, '23505', 'T6 duplicado: código');

  const ignorado = await requisitar('/rest/v1/checkins', {
    metodo: 'POST',
    token: a.token,
    consulta: { on_conflict: 'participante_id,arena_id,estacao' },
    corpo: { arena_id: ARENA, estacao: estacao('T6') },
    prefer: 'resolution=ignore-duplicates,return=representation',
  });
  assert.ok([200, 201].includes(ignorado.status), `T6 ignorar duplicados: ${resumo(ignorado)}`);
  assert.ok(Array.isArray(ignorado.dados) && ignorado.dados.length === 0, 'T6 ignorar duplicados: 0 linhas');

  const linhas = await lerPorId(a, 'checkins', estacao('T6'), 'estacao');
  assert.equal(linhas.length, 1, 'T6: continua 1 check-in');
});

caso('T7 conclui o próprio check-in', async () => {
  const a = await usuarioA();
  const c = await criarCheckin(a, 'T7');
  const r = await requisitar('/rest/v1/checkins', {
    metodo: 'PATCH',
    token: a.token,
    consulta: { id: `eq.${c.id}` },
    corpo: { status: 'concluido' },
    prefer: 'return=representation',
  });
  assert.equal(r.status, 200, 'T7: HTTP');
  assert.equal(r.dados?.length, 1, 'T7: 1 linha');
  assert.equal(r.dados[0].status, 'concluido', 'T7: status');
  assert.ok(r.dados[0].concluido_em, 'T7: concluido_em preenchido (trigger)');
});

caso('T7b não conclui duas vezes', async () => {
  const a = await usuarioA();
  const c = await criarCheckin(a, 'T7b', { concluir: true });
  esperarZeroLinhas(
    await requisitar('/rest/v1/checkins', {
      metodo: 'PATCH',
      token: a.token,
      consulta: { id: `eq.${c.id}` },
      corpo: { status: 'concluido' },
      prefer: 'return=representation',
    }),
    'T7b'
  );
  const [depois] = await lerPorId(a, 'checkins', c.id);
  assert.equal(depois.concluido_em, c.concluido_em, 'T7b: concluido_em inalterado');
});

caso('T7c não regrava status na fila', async () => {
  const a = await usuarioA();
  const c = await criarCheckin(a, 'T7c');
  esperarViolacaoDePolitica(
    await requisitar('/rest/v1/checkins', {
      metodo: 'PATCH',
      token: a.token,
      consulta: { id: `eq.${c.id}` },
      corpo: { status: 'na_fila' },
      prefer: 'return=representation',
    }),
    'checkins',
    'T7c'
  );
  const [depois] = await lerPorId(a, 'checkins', c.id);
  assert.equal(depois.status, 'na_fila', 'T7c: status inalterado');
});

caso('T7d não conclui check-in de outra pessoa', async () => {
  const a = await usuarioA();
  const b = await usuarioB();
  const cB = await criarCheckin(b, 'T7d'); // NA FILA: só o critério de dono pode bloquear
  esperarZeroLinhas(
    await requisitar('/rest/v1/checkins', {
      metodo: 'PATCH',
      token: a.token,
      consulta: { id: `eq.${cB.id}` },
      corpo: { status: 'concluido' },
      prefer: 'return=representation',
    }),
    'T7d'
  );
  const [depois] = await lerPorId(b, 'checkins', cB.id);
  assert.equal(depois.status, 'na_fila', 'T7d: B confirma que continua na fila');
});

caso('T8 avalia só check-in próprio e concluído', async () => {
  const a = await usuarioA();
  const b = await usuarioB();
  const naFila = await criarCheckin(a, 'T8-fila');
  const concluido = await criarCheckin(a, 'T8-ok', { concluir: true });
  const deB = await criarCheckin(b, 'T8-B', { concluir: true });

  const avaliar = (checkinId) =>
    requisitar('/rest/v1/feedbacks', {
      metodo: 'POST',
      token: a.token,
      corpo: { checkin_id: checkinId, nota: 4 },
      prefer: 'return=representation',
    });

  const r1 = await avaliar(naFila.id);
  esperarTrigger(r1, 'nao_permitido', 'Conclua a atividade', 'T8 na fila');

  const r2 = await avaliar(concluido.id);
  assert.equal(r2.status, 201, `T8 concluído: ${resumo(r2)}`);
  assert.equal(r2.dados?.[0]?.participante_id, a.id, 'T8 concluído: dono');

  const r3 = await avaliar(deB.id);
  esperarTrigger(r3, 'nao_permitido', 'Conclua a atividade', 'T8 check-in de B');
  assert.equal(r3.dados.message, r1.dados.message, 'T8: mesma mensagem (não revela o check-in de B)');
});

caso('T9 edita só nota e comentário da própria avaliação', async () => {
  const a = await usuarioA();
  const c = await criarCheckin(a, 'T9', { concluir: true });
  const outro = await criarCheckin(a, 'T9-outro', { concluir: true });
  const f = await criarAvaliacao(a, c.id, 3);

  const ok = await requisitar('/rest/v1/feedbacks', {
    metodo: 'PATCH',
    token: a.token,
    consulta: { id: `eq.${f.id}` },
    corpo: { nota: 5, comentario: 'Muito bom' },
    prefer: 'return=representation',
  });
  assert.equal(ok.status, 200, 'T9 nota: HTTP');
  assert.equal(ok.dados?.length, 1, 'T9 nota: 1 linha');
  assert.equal(ok.dados[0].nota, 5, 'T9 nota: valor');
  assert.ok(ok.dados[0].atualizado_em, 'T9 nota: atualizado_em preenchido (trigger)');

  esperarSemPermissao(
    await requisitar('/rest/v1/feedbacks', {
      metodo: 'PATCH',
      token: a.token,
      consulta: { id: `eq.${f.id}` },
      corpo: { checkin_id: outro.id },
      prefer: 'return=representation',
    }),
    'feedbacks',
    'T9 checkin_id'
  );
  const [depois] = await lerPorId(a, 'feedbacks', f.id);
  assert.equal(depois.checkin_id, c.id, 'T9: checkin_id inalterado');
});

caso('T9b upsert padrão de avaliação é barrado', async () => {
  const a = await usuarioA();
  const c = await criarCheckin(a, 'T9b', { concluir: true });
  const f = await criarAvaliacao(a, c.id, 2);

  esperarSemPermissao(
    await requisitar('/rest/v1/feedbacks', {
      metodo: 'POST',
      token: a.token,
      consulta: { on_conflict: 'checkin_id' },
      corpo: { checkin_id: c.id, nota: 5 },
      prefer: 'resolution=merge-duplicates,return=representation',
    }),
    'feedbacks',
    'T9b'
  );
  const [depois] = await lerPorId(a, 'feedbacks', f.id);
  assert.equal(depois.nota, 2, 'T9b: nota inalterada');
});

caso('T9c não altera a avaliação de outra pessoa', async () => {
  const a = await usuarioA();
  const b = await usuarioB();
  const cB = await criarCheckin(b, 'T9c', { concluir: true });
  const fB = await criarAvaliacao(b, cB.id, 3);

  esperarZeroLinhas(
    await requisitar('/rest/v1/feedbacks', {
      metodo: 'PATCH',
      token: a.token,
      consulta: { id: `eq.${fB.id}` },
      corpo: { nota: 1, comentario: 'Invasor' },
      prefer: 'return=representation',
    }),
    'T9c'
  );

  const [depois] = await lerPorId(b, 'feedbacks', fB.id);
  assert.equal(depois.nota, 3, 'T9c: B confirma nota inalterada');
  assert.equal(depois.comentario, null, 'T9c: B confirma comentário inalterado');
  assert.equal(depois.atualizado_em, null, 'T9c: B confirma atualizado_em inalterado');
});

caso('T10 nenhuma exclusão acontece', async () => {
  const a = await usuarioA();
  const b = await usuarioB();
  const cA = await criarCheckin(a, 'T10', { concluir: true });
  const fA = await criarAvaliacao(a, cA.id, 4);
  const cB = await criarCheckin(b, 'T10-B');
  const e = temEquipeConfigurada() ? await usuarioE() : null;

  const alvosA = [
    ['participantes', a.id],
    ['checkins', cA.id],
    ['feedbacks', fA.id],
  ];
  const alvosB = [
    ['participantes', b.id],
    ['checkins', cB.id],
  ];
  // Antes: cada dono confirma as próprias linhas.
  for (const [tabela, id] of alvosA) assert.equal((await lerPorId(a, tabela, id)).length, 1, `T10 antes A ${tabela}`);
  for (const [tabela, id] of alvosB) assert.equal((await lerPorId(b, tabela, id)).length, 1, `T10 antes B ${tabela}`);

  // Tentativas de A: próprias linhas, linhas de B e linha de E.
  for (const [tabela, id] of [...alvosA, ...alvosB]) {
    esperarSemPermissao(
      await requisitar(`/rest/v1/${tabela}`, {
        metodo: 'DELETE',
        token: a.token,
        consulta: { id: `eq.${id}` },
        prefer: 'return=representation',
      }),
      tabela,
      `T10 DELETE ${tabela}`
    );
  }
  if (e) {
    esperarSemPermissao(
      await requisitar('/rest/v1/membros_equipe', {
        metodo: 'DELETE',
        token: a.token,
        consulta: { user_id: `eq.${e.id}` },
        prefer: 'return=representation',
      }),
      'membros_equipe',
      'T10 DELETE membros_equipe'
    );
  }

  // Depois: os donos releem as mesmas linhas pelos ids.
  for (const [tabela, id] of alvosA) assert.equal((await lerPorId(a, tabela, id)).length, 1, `T10 depois A ${tabela}`);
  for (const [tabela, id] of alvosB) assert.equal((await lerPorId(b, tabela, id)).length, 1, `T10 depois B ${tabela}`);
  if (e) {
    assert.equal((await lerPorId(e, 'membros_equipe', e.id, 'user_id')).length, 1, 'T10 depois E membros_equipe');
  } else {
    registrar('T10: parte de membros_equipe não executada (E não configurado; coberta pelo T10 do SQL).');
  }
});

caso('T11 B não vê dados de A', async () => {
  const a = await usuarioA();
  const b = await usuarioB();
  const c = await criarCheckin(a, 'T11', { concluir: true });
  await criarAvaliacao(a, c.id, 4);
  const cB = await criarCheckin(b, 'T11-B');

  // Prova de que os dados de A existem agora.
  assert.equal((await lerPorId(a, 'participantes', a.id)).length, 1, 'T11 A tem cadastro');
  assert.equal((await lerPorId(a, 'checkins', c.id)).length, 1, 'T11 A tem check-in');
  assert.equal((await lerPorId(a, 'feedbacks', c.id, 'checkin_id')).length, 1, 'T11 A tem avaliação');

  // Controle positivo: B enxerga o que é dele.
  const cadastros = await lerTudo(b, 'participantes');
  assert.equal(cadastros.length, 1, 'T11 controle: B vê o próprio cadastro');
  assert.equal(cadastros[0].id, b.id, 'T11 controle: cadastro é de B');
  const checkinsB = await lerTudo(b, 'checkins');
  assert.ok(checkinsB.some((l) => l.id === cB.id), 'T11 controle: B vê o próprio check-in');

  assert.ok(checkinsB.every((l) => l.participante_id === b.id), 'T11 checkins: só B');
  const feedbacksB = await lerTudo(b, 'feedbacks');
  assert.ok(feedbacksB.every((l) => l.participante_id === b.id), 'T11 feedbacks: só B');
  assert.ok(!feedbacksB.some((l) => l.participante_id === a.id), 'T11 feedbacks: nada de A');
});

caso('T12 participante não lê membros_equipe', async () => {
  const e = await usuarioE(); // garante que a tabela tem ao menos uma linha
  const a = await usuarioA();
  assert.ok(e.id, 'T12: E presente');
  esperarZeroLinhas(
    await requisitar('/rest/v1/membros_equipe', { token: a.token, consulta: { select: '*' } }),
    'T12 leitura'
  );
});

caso('T12b participante não se cadastra na equipe', async () => {
  const a = await usuarioA();
  esperarSemPermissao(
    await requisitar('/rest/v1/membros_equipe', {
      metodo: 'POST',
      token: a.token,
      corpo: { user_id: a.id },
      prefer: 'return=representation',
    }),
    'membros_equipe',
    'T12b inserção'
  );
});

caso('T13 equipe vê só a própria linha de membros_equipe', async () => {
  const e = await usuarioE();
  const linhas = await lerTudo(e, 'membros_equipe');
  assert.equal(linhas.length, 1, 'T13: quantidade');
  assert.equal(linhas[0].user_id, e.id, 'T13: user_id');
  registrar('T13: com um único membro no projeto de teste, "só a própria linha" é provado no T13 do SQL (E e X).');
});

caso('T14 equipe não lê dados pessoais diretamente', async () => {
  const e = await usuarioE();
  const a = await usuarioA();
  const c = await criarCheckin(a, 'T14', { concluir: true });
  await criarAvaliacao(a, c.id, 4);
  assert.equal((await lerPorId(a, 'feedbacks', c.id, 'checkin_id')).length, 1, 'T14: dados de A existem');

  for (const tabela of ['participantes', 'checkins', 'feedbacks']) {
    esperarZeroLinhas(
      await requisitar(`/rest/v1/${tabela}`, { token: e.token, consulta: { select: '*' } }),
      `T14 ${tabela}`
    );
  }
});

test('T15 eh_equipe() por perfil', { skip: 'somente no SQL: supabase/tests/rls.sql.test.sql' }, () => {});

caso('T16 função privada não fica exposta na API', async () => {
  const a = await usuarioA();
  const r = await requisitar('/rest/v1/rpc/eh_equipe', { metodo: 'POST', token: a.token, corpo: {} });
  assert.equal(r.status, 404, 'T16: HTTP');
  assert.equal(r.dados?.code, 'PGRST202', 'T16: função não encontrada na API');
});

caso('T17 triggers disparam para usuário comum', async () => {
  const a = await usuarioA();
  const c = await criarCheckin(a, 'T17');
  assert.equal(c.status, 'na_fila', 'T17: status inicial');
  assert.ok(c.criado_em, 'T17: criado_em preenchido');
  assert.equal(c.concluido_em, null, 'T17: concluido_em vazio');

  const r = await requisitar('/rest/v1/checkins', {
    metodo: 'PATCH',
    token: a.token,
    consulta: { id: `eq.${c.id}` },
    corpo: { status: 'concluido' },
    prefer: 'return=representation',
  });
  assert.equal(r.status, 200, `T17 conclusão: ${resumo(r)}`);
  const concluido = r.dados?.[0];
  assert.ok(concluido?.concluido_em, 'T17: concluido_em preenchido pelo servidor');
  assert.ok(Date.parse(concluido.concluido_em) >= Date.parse(concluido.criado_em), 'T17: concluido_em >= criado_em');

  const f = await criarAvaliacao(a, c.id, 3);
  assert.ok(f.criado_em, 'T17: avaliação com criado_em');
  assert.equal(f.atualizado_em, null, 'T17: avaliação nova sem atualizado_em');

  const outro = await criarCheckin(a, 'T17-fila');
  esperarTrigger(
    await requisitar('/rest/v1/feedbacks', {
      metodo: 'POST',
      token: a.token,
      corpo: { checkin_id: outro.id, nota: 3 },
      prefer: 'return=representation',
    }),
    'nao_permitido',
    'Conclua a atividade',
    'T17 trigger de avaliação'
  );
});

caso('T18 RETURNING devolve só linhas próprias', async () => {
  const a = await usuarioA();
  const b = await usuarioB();
  const cA = await criarCheckin(a, 'T18');
  const cB = await criarCheckin(b, 'T18');
  const nomeEstacao = estacao('T18');

  // Pré-condição: os DOIS estão na fila e satisfazem o mesmo filtro.
  const [antesA] = await lerPorId(a, 'checkins', cA.id);
  const [antesB] = await lerPorId(b, 'checkins', cB.id);
  for (const [rotulo, linha] of [
    ['A', antesA],
    ['B', antesB],
  ]) {
    assert.equal(linha?.status, 'na_fila', `T18 pré-condição: check-in de ${rotulo} na fila`);
    assert.equal(linha?.estacao, nomeEstacao, `T18 pré-condição: check-in de ${rotulo} na estação do filtro`);
  }

  const r = await requisitar('/rest/v1/checkins', {
    metodo: 'PATCH',
    token: a.token,
    consulta: { status: 'eq.na_fila', estacao: `eq.${nomeEstacao}` },
    corpo: { status: 'concluido' },
    prefer: 'return=representation',
  });
  assert.equal(r.status, 200, 'T18: HTTP');
  assert.equal(r.dados?.length, 1, 'T18: só 1 linha devolvida');
  assert.equal(r.dados[0].id, cA.id, 'T18: a linha devolvida é a de A');
  assert.ok(r.dados.every((l) => l.participante_id === a.id), 'T18: nada de B no retorno');

  const [depoisB] = await lerPorId(b, 'checkins', cB.id);
  assert.equal(depoisB.status, 'na_fila', 'T18: B confirma que o dele continua na fila');
  const [depoisA] = await lerPorId(a, 'checkins', cA.id);
  assert.equal(depoisA.status, 'concluido', 'T18: o de A foi concluído');
});

test('T19 conferência estrutural', { skip: 'somente no SQL: supabase/tests/rls.sql.test.sql' }, () => {});

caso('EXTRA tokens reais com as marcas corretas', async () => {
  const a = await usuarioA();
  assert.equal(conferirToken(a.token, 'A', a.id, true).is_anonymous, true, 'EXTRA A anônimo');
  const p = await usuarioP();
  assert.equal(conferirToken(p.token, 'P', p.id, false).is_anonymous, false, 'EXTRA P permanente');
  const e = await usuarioE();
  assert.equal(conferirToken(e.token, 'E', e.id, false).is_anonymous, false, 'EXTRA E permanente');
});

import { obterSupabase } from '../lib/supabase';
// Somente TIPOS de checkins.ts (removidos na compilação): sem dependência em tempo de execução.
import type { Checkin, FiltroCheckins, ResultadoRegistro, TotalPorAtividade } from './checkins';
import { ErroCheckin } from './erros';
import { converterErroCheckin } from './errosSupabase';
import { obterIdDaSessaoAtual } from './identidadeSupabase';

/**
 * Check-ins no Supabase (implementação usada por checkins.ts, a interface pública).
 *
 * Regras:
 * - NUNCA faz login anônimo: usa apenas a sessão já existente (criada no cadastro).
 * - Respeita RLS, permissões por coluna e triggers (0001/0002/0003):
 *     INSERT só de arena_id e estacao (participante_id = auth.uid() pelo default;
 *       status 'na_fila' e datas definidos pelo trigger);
 *     UPDATE só de status, e só 'na_fila' -> 'concluido' (política + trigger);
 *     SELECT só das próprias linhas.
 * - Sem upsert: duplicata (23505) devolve o check-in existente, sem criar outro.
 * - Indicadores gerais do evento NÃO são calculados aqui: pelo RLS, o resultado
 *   seria só do próprio usuário. Eles virão de resumo_painel() (etapa S3).
 */

const COLUNAS = 'id, participante_id, arena_id, estacao, status, criado_em, concluido_em';

const MENSAGEM_SEM_CADASTRO = 'Faça seu cadastro antes de entrar na fila.';
const MENSAGEM_INDICADORES =
  'Indicadores gerais do evento ainda não estão disponíveis no servidor (etapa S3).';

type LinhaCheckin = {
  id: string;
  participante_id: string;
  arena_id: string;
  estacao: string;
  status: Checkin['status'];
  criado_em: string;
  concluido_em: string | null;
};

function paraCheckin(linha: LinhaCheckin): Checkin {
  return {
    id: linha.id,
    participanteId: linha.participante_id,
    arenaId: linha.arena_id,
    estacao: linha.estacao,
    status: linha.status,
    criadoEm: linha.criado_em,
    concluidoEm: linha.concluido_em,
  };
}

/** Validação de texto obrigatório (mensagens exibidas nas telas). */
function textoObrigatorio(valor: string, campo: string): string {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) {
    throw new ErroCheckin('validacao', `Informe ${campo}.`);
  }
  return texto;
}

/** ID da sessão existente, ou erro pedindo o cadastro. Não faz login. */
async function exigirSessao(): Promise<string> {
  let id: string | null;
  try {
    id = await obterIdDaSessaoAtual();
  } catch (erro) {
    throw new ErroCheckin('banco', 'Não foi possível verificar sua sessão. Tente novamente.', erro);
  }
  if (!id) throw new ErroCheckin('validacao', MENSAGEM_SEM_CADASTRO);
  return id;
}

/** ID da sessão existente, ou null (para leituras: sem sessão, não há dados próprios). */
async function sessaoOpcional(): Promise<string | null> {
  try {
    return await obterIdDaSessaoAtual();
  } catch (erro) {
    throw new ErroCheckin('banco', 'Não foi possível verificar sua sessão. Tente novamente.', erro);
  }
}

/** Garante que o cadastro do participante existe antes do primeiro check-in. */
async function exigirCadastro(participanteId: string): Promise<void> {
  const { data, error } = await obterSupabase()
    .from('participantes')
    .select('id')
    .eq('id', participanteId)
    .maybeSingle();
  if (error) throw converterErroCheckin(error, 'Não foi possível verificar seu cadastro.');
  if (!data) throw new ErroCheckin('validacao', MENSAGEM_SEM_CADASTRO);
}

async function buscarPorAtividade(
  participanteId: string,
  arenaId: string,
  estacao: string
): Promise<Checkin | null> {
  const { data, error } = await obterSupabase()
    .from('checkins')
    .select(COLUNAS)
    .eq('participante_id', participanteId)
    .eq('arena_id', arenaId)
    .eq('estacao', estacao)
    .maybeSingle();
  if (error) throw converterErroCheckin(error, 'Não foi possível consultar o check-in.');
  return data ? paraCheckin(data as LinhaCheckin) : null;
}

/**
 * Registra o check-in do participante da sessão em uma arena + estação.
 * Se já existir, devolve o existente (novo: false) sem alterar o status.
 */
export async function registrarCheckin(arenaId: string, estacao: string): Promise<ResultadoRegistro> {
  const arena = textoObrigatorio(arenaId, 'a arena');
  const nomeEstacao = textoObrigatorio(estacao, 'a estação');
  const participanteId = await exigirSessao();
  await exigirCadastro(participanteId);

  const { data, error } = await obterSupabase()
    .from('checkins')
    .insert({ arena_id: arena, estacao: nomeEstacao })
    .select(COLUNAS)
    .single();

  if (!error && data) {
    return { checkin: paraCheckin(data as LinhaCheckin), novo: true };
  }

  if (error?.code === '23505') {
    // Já existe check-in nesta atividade: reaproveita, sem duplicar.
    const existente = await buscarPorAtividade(participanteId, arena, nomeEstacao);
    if (!existente) {
      throw new ErroCheckin('banco', 'O check-in existente não foi encontrado.');
    }
    return { checkin: existente, novo: false };
  }

  throw converterErroCheckin(
    error ?? { code: '', message: '', hint: '' },
    'Não foi possível registrar o check-in.'
  );
}

/**
 * Marca como concluída uma atividade do participante da sessão.
 * Repetir a chamada em um check-in já concluído não altera nada e devolve o registro.
 */
export async function concluirCheckin(checkinId: string): Promise<Checkin> {
  const id = textoObrigatorio(checkinId, 'o check-in');
  const participanteId = await exigirSessao();

  const { data, error } = await obterSupabase()
    .from('checkins')
    .update({ status: 'concluido' })
    .eq('id', id)
    .eq('participante_id', participanteId)
    .select(COLUNAS);
  if (error) throw converterErroCheckin(error, 'Não foi possível concluir a atividade.');

  if (data && data.length === 1) return paraCheckin(data[0] as LinhaCheckin);

  // 0 linhas: já estava concluído (política exige 'na_fila') ou não é deste participante.
  const atual = await obterCheckin(id);
  if (!atual) throw new ErroCheckin('nao_encontrado', 'Check-in não encontrado.');
  return atual;
}

/** Busca um check-in do participante da sessão (null se não existir ou não houver sessão). */
export async function obterCheckin(checkinId: string): Promise<Checkin | null> {
  const id = textoObrigatorio(checkinId, 'o check-in');
  const participanteId = await sessaoOpcional();
  if (!participanteId) return null;

  const { data, error } = await obterSupabase()
    .from('checkins')
    .select(COLUNAS)
    .eq('id', id)
    .eq('participante_id', participanteId)
    .maybeSingle();
  if (error) throw converterErroCheckin(error, 'Não foi possível consultar o check-in.');
  return data ? paraCheckin(data as LinhaCheckin) : null;
}

/** Check-ins do participante da sessão, do mais recente ao mais antigo. */
export async function listarMeusCheckins(): Promise<Checkin[]> {
  const participanteId = await sessaoOpcional();
  if (!participanteId) return [];

  const { data, error } = await obterSupabase()
    .from('checkins')
    .select(COLUNAS)
    .eq('participante_id', participanteId)
    .order('criado_em', { ascending: false });
  if (error) throw converterErroCheckin(error, 'Não foi possível listar seus check-ins.');
  return (data ?? []).map((linha) => paraCheckin(linha as LinhaCheckin));
}

/**
 * Check-ins concluídos do participante que ainda não receberam avaliação.
 * Duas consultas simples (sem junção pela chave estrangeira composta).
 */
export async function listarPendentesDeFeedback(): Promise<Checkin[]> {
  const participanteId = await sessaoOpcional();
  if (!participanteId) return [];
  const supabase = obterSupabase();

  const { data: concluidos, error: erroCheckins } = await supabase
    .from('checkins')
    .select(COLUNAS)
    .eq('participante_id', participanteId)
    .eq('status', 'concluido')
    .order('concluido_em', { ascending: false });
  if (erroCheckins) throw converterErroCheckin(erroCheckins, 'Não foi possível listar atividades para avaliar.');

  const { data: avaliados, error: erroFeedbacks } = await supabase
    .from('feedbacks')
    .select('checkin_id')
    .eq('participante_id', participanteId);
  if (erroFeedbacks) throw converterErroCheckin(erroFeedbacks, 'Não foi possível listar atividades para avaliar.');

  const jaAvaliados = new Set((avaliados ?? []).map((linha) => (linha as { checkin_id: string }).checkin_id));
  return (concluidos ?? [])
    .map((linha) => paraCheckin(linha as LinhaCheckin))
    .filter((checkin) => !jaAvaliados.has(checkin.id));
}

// ---------------------------------------------------------------------
// Indicadores gerais: bloqueados até a etapa S3.
// (Com RLS, devolveriam só os dados do próprio usuário, como se fossem
// totais do evento.)
// ---------------------------------------------------------------------

export async function listarCheckins(_filtro?: FiltroCheckins): Promise<Checkin[]> {
  throw new ErroCheckin('banco', MENSAGEM_INDICADORES);
}

export async function contarParticipantesUnicos(
  _filtro?: Pick<FiltroCheckins, 'arenaId' | 'estacao'>
): Promise<number> {
  throw new ErroCheckin('banco', MENSAGEM_INDICADORES);
}

export async function totaisPorAtividade(): Promise<TotalPorAtividade[]> {
  throw new ErroCheckin('banco', MENSAGEM_INDICADORES);
}

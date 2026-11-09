import { obterSupabase } from '../lib/supabase';
import { ErroFeedback } from './erros';
import { converterErroFeedback } from './errosSupabase';
// Somente TIPOS de feedback.ts (removidos na compilação): sem dependência em tempo de execução.
import type {
  DadosFeedback,
  Feedback,
  FeedbackDetalhado,
  FiltroFeedbacks,
  ResultadoFeedback,
  ResumoFeedbacks,
} from './feedback';
import { obterIdDaSessaoAtual } from './identidadeSupabase';

/**
 * Avaliações no Supabase (implementação usada por feedback.ts, a interface pública).
 *
 * Regras:
 * - NUNCA faz login anônimo: usa apenas a sessão já existente.
 * - Salvar = SELECT da própria avaliação -> UPDATE (nota, comentario) ou INSERT
 *   (checkin_id, nota, comentario). SEM upsert: o upsert padrão da API faria
 *   SET em checkin_id, coluna sem permissão de UPDATE (teste T9b).
 * - Respeita RLS, permissões por coluna e o trigger da 0001, que só aceita
 *   avaliação de check-in CONCLUÍDO do próprio participante.
 * - Indicadores gerais (listarFeedbacks, resumoFeedbacks) NÃO são calculados
 *   aqui: pelo RLS seriam só do próprio usuário. Virão de resumo_painel() (S3).
 */

// Mesmos limites de feedback.ts e dos CHECKs da 0001 (definidos aqui para não
// criar dependência em tempo de execução com feedback.ts).
const NOTA_MINIMA = 1;
const NOTA_MAXIMA = 5;
const COMENTARIO_MAXIMO = 300;

const COLUNAS = 'id, checkin_id, participante_id, nota, comentario, criado_em, atualizado_em';

const MENSAGEM_SEM_SESSAO = 'Faça seu cadastro antes de avaliar uma atividade.';
const MENSAGEM_INDICADORES =
  'Indicadores gerais do evento ainda não estão disponíveis no servidor (etapa S3).';

type LinhaFeedback = {
  id: string;
  checkin_id: string;
  participante_id: string;
  nota: number;
  comentario: string | null;
  criado_em: string;
  atualizado_em: string | null;
};

function paraFeedback(linha: LinhaFeedback): Feedback {
  return {
    id: linha.id,
    checkinId: linha.checkin_id,
    participanteId: linha.participante_id,
    nota: linha.nota,
    comentario: linha.comentario,
    criadoEm: linha.criado_em,
    atualizadoEm: linha.atualizado_em,
  };
}

// ---------------------------------------------------------------------
// Validações (mensagens exibidas nas telas).
// ---------------------------------------------------------------------

function textoObrigatorio(valor: string, campo: string): string {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  if (!texto) {
    throw new ErroFeedback('validacao', `Informe ${campo}.`);
  }
  return texto;
}

function validarNota(nota: number): number {
  if (!Number.isInteger(nota) || nota < NOTA_MINIMA || nota > NOTA_MAXIMA) {
    throw new ErroFeedback('validacao', `Escolha uma nota de ${NOTA_MINIMA} a ${NOTA_MAXIMA} estrelas.`);
  }
  return nota;
}

/** Comentário vazio vira null; conta caracteres reais (emojis contam como 1). */
function validarComentario(comentario: string | null | undefined): string | null {
  if (comentario === null || comentario === undefined) return null;
  if (typeof comentario !== 'string') {
    throw new ErroFeedback('validacao', 'Comentário inválido.');
  }
  const texto = comentario.trim();
  if (!texto) return null;
  if ([...texto].length > COMENTARIO_MAXIMO) {
    throw new ErroFeedback('validacao', `O comentário pode ter no máximo ${COMENTARIO_MAXIMO} caracteres.`);
  }
  return texto;
}

// ---------------------------------------------------------------------
// Sessão (sem login)
// ---------------------------------------------------------------------

async function sessaoOpcional(): Promise<string | null> {
  try {
    return await obterIdDaSessaoAtual();
  } catch (erro) {
    throw new ErroFeedback('banco', 'Não foi possível verificar sua sessão. Tente novamente.', erro);
  }
}

async function exigirSessao(): Promise<string> {
  const id = await sessaoOpcional();
  if (!id) throw new ErroFeedback('nao_permitido', MENSAGEM_SEM_SESSAO);
  return id;
}

async function buscarAvaliacaoDoCheckin(
  participanteId: string,
  checkinId: string
): Promise<Feedback | null> {
  const { data, error } = await obterSupabase()
    .from('feedbacks')
    .select(COLUNAS)
    .eq('checkin_id', checkinId)
    .eq('participante_id', participanteId)
    .maybeSingle();
  if (error) throw converterErroFeedback(error, 'Não foi possível consultar a avaliação.');
  return data ? paraFeedback(data as LinhaFeedback) : null;
}

async function atualizarAvaliacao(
  participanteId: string,
  feedbackId: string,
  nota: number,
  comentario: string | null
): Promise<Feedback> {
  const { data, error } = await obterSupabase()
    .from('feedbacks')
    .update({ nota, comentario })
    .eq('id', feedbackId)
    .eq('participante_id', participanteId)
    .select(COLUNAS);
  if (error) throw converterErroFeedback(error);
  if (!data || data.length !== 1) {
    throw new ErroFeedback('nao_permitido', 'Não foi possível atualizar sua avaliação.');
  }
  return paraFeedback(data[0] as LinhaFeedback);
}

// ---------------------------------------------------------------------
// API pública (mesmas assinaturas de feedback.ts)
// ---------------------------------------------------------------------

/**
 * Salva a avaliação de uma atividade CONCLUÍDA do participante da sessão.
 * Se já existir avaliação para o check-in, atualiza (novo: false), sem duplicar.
 */
export async function salvarFeedback(dados: DadosFeedback): Promise<ResultadoFeedback> {
  const checkinId = textoObrigatorio(dados.checkinId, 'a atividade');
  const nota = validarNota(dados.nota);
  const comentario = validarComentario(dados.comentario);
  const participanteId = await exigirSessao();
  const supabase = obterSupabase();

  // Verifica antes de gravar (mensagem amigável); o trigger da 0001
  // repete a regra no banco.
  const { data: checkin, error: erroCheckin } = await supabase
    .from('checkins')
    .select('id, status')
    .eq('id', checkinId)
    .eq('participante_id', participanteId)
    .maybeSingle();
  if (erroCheckin) throw converterErroFeedback(erroCheckin, 'Não foi possível consultar a atividade.');
  if (!checkin) throw new ErroFeedback('nao_encontrado', 'Atividade não encontrada.');
  if ((checkin as { status: string }).status !== 'concluido') {
    throw new ErroFeedback('nao_permitido', 'Conclua a atividade antes de avaliá-la.');
  }

  const existente = await buscarAvaliacaoDoCheckin(participanteId, checkinId);
  if (existente) {
    const feedback = await atualizarAvaliacao(participanteId, existente.id, nota, comentario);
    return { feedback, novo: false };
  }

  const { data, error } = await supabase
    .from('feedbacks')
    .insert({ checkin_id: checkinId, nota, comentario })
    .select(COLUNAS)
    .single();

  if (!error && data) {
    return { feedback: paraFeedback(data as LinhaFeedback), novo: true };
  }

  if (error?.code === '23505') {
    // Outra tentativa criou a avaliação ao mesmo tempo: atualiza em vez de duplicar.
    const criada = await buscarAvaliacaoDoCheckin(participanteId, checkinId);
    if (!criada) throw new ErroFeedback('banco', 'A avaliação existente não foi encontrada.');
    const feedback = await atualizarAvaliacao(participanteId, criada.id, nota, comentario);
    return { feedback, novo: false };
  }

  throw converterErroFeedback(error ?? { code: '', message: '', hint: '' });
}

/** Avaliação de um check-in do participante da sessão (null se não houver ou sem sessão). */
export async function obterFeedbackDoCheckin(checkinId: string): Promise<Feedback | null> {
  const id = textoObrigatorio(checkinId, 'a atividade');
  const participanteId = await sessaoOpcional();
  if (!participanteId) return null;
  return buscarAvaliacaoDoCheckin(participanteId, id);
}

/**
 * Avaliações do participante da sessão, da mais recente à mais antiga.
 * Duas consultas simples (avaliações e check-ins), sem junção pela chave composta.
 */
export async function listarMeusFeedbacks(): Promise<FeedbackDetalhado[]> {
  const participanteId = await sessaoOpcional();
  if (!participanteId) return [];
  const supabase = obterSupabase();

  const { data: linhas, error } = await supabase
    .from('feedbacks')
    .select(COLUNAS)
    .eq('participante_id', participanteId);
  if (error) throw converterErroFeedback(error, 'Não foi possível listar suas avaliações.');

  const feedbacks = (linhas ?? []).map((linha) => paraFeedback(linha as LinhaFeedback));
  if (feedbacks.length === 0) return [];

  const { data: checkins, error: erroCheckins } = await supabase
    .from('checkins')
    .select('id, arena_id, estacao')
    .eq('participante_id', participanteId)
    .in(
      'id',
      feedbacks.map((feedback) => feedback.checkinId)
    );
  if (erroCheckins) throw converterErroFeedback(erroCheckins, 'Não foi possível listar suas avaliações.');

  const atividades = new Map(
    (checkins ?? []).map((linha) => {
      const c = linha as { id: string; arena_id: string; estacao: string };
      return [c.id, { arenaId: c.arena_id, estacao: c.estacao }] as const;
    })
  );

  // Ordem: COALESCE(atualizado_em, criado_em) DESC (mais recente primeiro).
  const momento = (f: Feedback) => f.atualizadoEm ?? f.criadoEm;
  return feedbacks
    .sort((x, y) => (momento(x) < momento(y) ? 1 : momento(x) > momento(y) ? -1 : 0))
    .map((feedback) => ({
      ...feedback,
      arenaId: atividades.get(feedback.checkinId)?.arenaId ?? '',
      estacao: atividades.get(feedback.checkinId)?.estacao ?? '',
    }));
}

// ---------------------------------------------------------------------
// Indicadores gerais: bloqueados até a etapa S3.
// ---------------------------------------------------------------------

export async function listarFeedbacks(_filtro?: FiltroFeedbacks): Promise<FeedbackDetalhado[]> {
  throw new ErroFeedback('banco', MENSAGEM_INDICADORES);
}

export async function resumoFeedbacks(_filtro?: FiltroFeedbacks): Promise<ResumoFeedbacks> {
  throw new ErroFeedback('banco', MENSAGEM_INDICADORES);
}

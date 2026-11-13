import { obterSupabase } from '../lib/supabase';
import { ErroPainel } from './erros';
import { converterErroPainel } from './errosSupabase';

/**
 * Indicadores agregados do evento para o painel da equipe (etapa S3).
 *
 * Nenhuma função aqui devolve dado pessoal do participante (nome, cidade,
 * idade individual): tudo vem de funções do Postgres (SECURITY DEFINER)
 * que conferem privado.eh_equipe() antes de calcular qualquer agregado
 * (ver supabase/migrations/0004_posicao_e_painel.sql).
 */

export type ResumoGeral = {
  totalParticipantes: number;
  totalCheckins: number;
  checkinsNaFila: number;
  checkinsConcluidos: number;
};

export type ResumoAtividade = {
  arenaId: string;
  estacao: string;
  totalCheckins: number;
  participantesUnicos: number;
  concluidos: number;
};

export type FaixaEtaria = {
  faixa: string;
  total: number;
};

/** Totais gerais do evento (participantes, check-ins, fila, concluídos). */
export async function resumoGeral(): Promise<ResumoGeral> {
  const { data, error } = await obterSupabase().rpc('resumo_geral');
  if (error) throw converterErroPainel(error, 'Não foi possível carregar o resumo geral.');

  const linha = data?.[0];
  if (!linha) {
    return { totalParticipantes: 0, totalCheckins: 0, checkinsNaFila: 0, checkinsConcluidos: 0 };
  }
  return {
    totalParticipantes: Number(linha.total_participantes ?? 0),
    totalCheckins: Number(linha.total_checkins ?? 0),
    checkinsNaFila: Number(linha.checkins_na_fila ?? 0),
    checkinsConcluidos: Number(linha.checkins_concluidos ?? 0),
  };
}

/** Totais por arena + estação (uma linha por atividade que já teve check-in). */
export async function resumoPorAtividade(): Promise<ResumoAtividade[]> {
  const { data, error } = await obterSupabase().rpc('resumo_por_atividade');
  if (error) throw converterErroPainel(error, 'Não foi possível carregar os totais por atividade.');

  type LinhaAtividade = {
    arena_id: string;
    estacao: string;
    total_checkins: number;
    participantes_unicos: number;
    concluidos: number;
  };
  return ((data ?? []) as LinhaAtividade[]).map((linha) => ({
    arenaId: linha.arena_id,
    estacao: linha.estacao,
    totalCheckins: Number(linha.total_checkins ?? 0),
    participantesUnicos: Number(linha.participantes_unicos ?? 0),
    concluidos: Number(linha.concluidos ?? 0),
  }));
}

/** Distribuição de idade dos participantes com ao menos um check-in. */
export async function resumoFaixaEtaria(): Promise<FaixaEtaria[]> {
  const { data, error } = await obterSupabase().rpc('resumo_faixa_etaria');
  if (error) throw converterErroPainel(error, 'Não foi possível carregar a faixa etária.');

  type LinhaFaixa = { faixa: string; total: number };
  return ((data ?? []) as LinhaFaixa[]).map((linha) => ({
    faixa: linha.faixa,
    total: Number(linha.total ?? 0),
  }));
}

export { ErroPainel };

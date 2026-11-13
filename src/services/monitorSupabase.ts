import { obterSupabase } from '../lib/supabase';
import { ErroCheckin } from './erros';
import { converterErroCheckin } from './errosSupabase';

/**
 * Fila pública de uma atividade (tela de monitor/TV).
 *
 * Usa fila_publica() (SECURITY DEFINER): devolve só apelido + posição,
 * nunca o id do participante, idade ou cidade. Exige sessão autenticada
 * (participante ou equipe), mas não exige ser dono de nada — é a mesma
 * informação que apareceria num painel físico de senhas no evento.
 */

export type ItemFilaPublica = {
  apelido: string;
  posicao: number;
};

export async function obterFilaPublica(arenaId: string, estacao: string): Promise<ItemFilaPublica[]> {
  const { data, error } = await obterSupabase().rpc('fila_publica', {
    p_arena_id: arenaId,
    p_estacao: estacao,
  });
  if (error) throw converterErroCheckin(error, 'Não foi possível carregar a fila.');

  return (data ?? []).map((linha: { apelido: string; posicao: number }) => ({
    apelido: linha.apelido,
    posicao: Number(linha.posicao),
  }));
}

export { ErroCheckin };

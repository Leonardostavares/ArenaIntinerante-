import { obterSupabase } from '../lib/supabase';
import { ErroPainel } from './erros';
import { converterErroPainel } from './errosSupabase';

/**
 * Arenas e suas estações (supabase/migrations/0005_arenas.sql).
 *
 * Leitura liberada a qualquer sessão autenticada (participante escolhe a
 * arena antes de existir qualquer outra credencial). Criação só para a
 * equipe: o próprio banco recusa (RLS) se quem chamar não estiver em
 * membros_equipe.
 */

export type Arena = {
  id: string;
  nome: string;
  local: string | null;
  estacoes: string[];
};

type LinhaArena = {
  id: string;
  nome: string;
  local: string | null;
  estacoes: string[];
};

function paraArena(linha: LinhaArena): Arena {
  return { id: linha.id, nome: linha.nome, local: linha.local, estacoes: linha.estacoes ?? [] };
}

/** Lista todas as arenas cadastradas, ordenadas por nome. */
export async function listarArenas(): Promise<Arena[]> {
  const { data, error } = await obterSupabase()
    .from('arenas')
    .select('id, nome, local, estacoes')
    .order('nome');
  if (error) throw converterErroPainel(error, 'Não foi possível carregar as arenas.');
  return (data ?? []).map((linha) => paraArena(linha as LinhaArena));
}

/** Busca uma arena pelo id (null se não existir). */
export async function obterArena(id: string): Promise<Arena | null> {
  const { data, error } = await obterSupabase()
    .from('arenas')
    .select('id, nome, local, estacoes')
    .eq('id', id)
    .maybeSingle();
  if (error) throw converterErroPainel(error, 'Não foi possível carregar a arena.');
  return data ? paraArena(data as LinhaArena) : null;
}

function slugify(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
}

export type NovaArena = {
  nome: string;
  local: string;
  estacoes: string[];
};

/**
 * Cria uma arena nova. O id é derivado do nome (slug); se já existir,
 * o banco recusa por chave duplicada (23505), traduzido para o chamador.
 * Só funciona para quem já está em membros_equipe (RLS garante isso).
 */
export async function criarArena(dados: NovaArena): Promise<Arena> {
  const id = slugify(dados.nome);
  const { data, error } = await obterSupabase()
    .from('arenas')
    .insert({ id, nome: dados.nome, local: dados.local, estacoes: dados.estacoes })
    .select('id, nome, local, estacoes')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw converterErroPainel(error, 'Já existe uma arena com um nome parecido.');
    }
    throw converterErroPainel(error, 'Não foi possível criar a arena.');
  }
  return paraArena(data as LinhaArena);
}

export { ErroPainel };

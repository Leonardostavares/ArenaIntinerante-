import type { AuthError, PostgrestError } from '@supabase/supabase-js';
import { iniciarRenovacaoDaSessao, obterSupabase, pararRenovacaoDaSessao } from '../lib/supabase';

/**
 * Identidade e cadastro do participante no Supabase.
 *
 * Única fonte de identidade do app: o ID do participante é o ID do usuário
 * anônimo do Supabase Auth (usado por participante.ts e pelo contexto).
 *
 * Regras:
 * - Login anônimo SOB DEMANDA: só quando o participante confirma o cadastro.
 * - Uma única tentativa por vez (promessa compartilhada), para não criar
 *   vários usuários anônimos para o mesmo aparelho.
 * - Sessão já salva no aparelho é reaproveitada; nunca é descartada por erro.
 * - Cadastro por SELECT -> UPDATE ou INSERT (sem upsert), compatível com o
 *   RLS e com as permissões por coluna da 0002/0003:
 *     INSERT (id, apelido, cidade, idade) com id = auth.uid();
 *     UPDATE somente de apelido, cidade e idade.
 */

export type CodigoErroIdentidade =
  | 'rede'
  | 'limite'
  | 'configuracao'
  | 'nao_permitido'
  | 'validacao'
  | 'servidor';

/** Erro da identidade/cadastro no Supabase. A mensagem é segura para exibir. */
export class ErroIdentidade extends Error {
  readonly codigo: CodigoErroIdentidade;
  readonly causa?: unknown;

  constructor(codigo: CodigoErroIdentidade, mensagem: string, causa?: unknown) {
    super(mensagem);
    this.name = 'ErroIdentidade';
    this.codigo = codigo;
    this.causa = causa;
  }
}

export type CadastroParticipante = {
  apelido: string;
  cidade: string;
  idade: number;
};

function ehFalhaDeRede(mensagem: string | undefined): boolean {
  return /network request failed|failed to fetch|network/i.test(mensagem ?? '');
}

function converterErroAuth(erro: AuthError | null): ErroIdentidade {
  if (!erro) {
    return new ErroIdentidade('servidor', 'Não foi possível iniciar sua sessão. Tente novamente.');
  }
  if (erro.status === 429) {
    return new ErroIdentidade('limite', 'Muitas tentativas agora. Aguarde alguns minutos e tente de novo.', erro);
  }
  if (erro.code === 'anonymous_provider_disabled') {
    return new ErroIdentidade('configuracao', 'O acesso de participantes está indisponível no momento.', erro);
  }
  if (erro.name === 'AuthRetryableFetchError' || erro.status === 0 || ehFalhaDeRede(erro.message)) {
    return new ErroIdentidade('rede', 'Sem conexão com a internet. Verifique e tente novamente.', erro);
  }
  return new ErroIdentidade('servidor', 'Não foi possível iniciar sua sessão. Tente novamente.', erro);
}

function converterErroBanco(erro: PostgrestError): ErroIdentidade {
  if (erro.code === '42501') {
    return new ErroIdentidade('nao_permitido', 'Operação não permitida para esta sessão.', erro);
  }
  if (erro.code === '23514' || erro.code === '23502' || erro.code === '22P02') {
    return new ErroIdentidade('validacao', 'Dados do cadastro inválidos. Confira e tente novamente.', erro);
  }
  if (!erro.code && ehFalhaDeRede(erro.message)) {
    return new ErroIdentidade('rede', 'Sem conexão com a internet. Verifique e tente novamente.', erro);
  }
  return new ErroIdentidade('servidor', 'Não foi possível salvar seus dados. Tente novamente.', erro);
}

/**
 * ID da sessão já salva no aparelho, SEM criar usuário.
 * (Se o token de acesso venceu, a biblioteca pode renová-lo; renovar não cria usuário.)
 */
export async function obterIdDaSessaoAtual(): Promise<string | null> {
  const { data, error } = await obterSupabase().auth.getSession();
  if (error) throw converterErroAuth(error);
  return data.session?.user.id ?? null;
}

/**
 * Observa mudanças de autenticação (login, renovação, saída) e informa o ID
 * do usuário atual (ou null). Não faz login nem chamadas de escrita.
 * Devolve a função de limpeza: remove o listener e para a renovação da sessão.
 */
export function observarIdentidade(aoMudar: (id: string | null) => void): () => void {
  const { data } = obterSupabase().auth.onAuthStateChange((_evento, sessao) => {
    aoMudar(sessao?.user.id ?? null);
    if (sessao) {
      // A biblioteca recomenda não chamar métodos do Supabase dentro deste
      // callback; a renovação é ligada logo depois, fora dele.
      setTimeout(() => iniciarRenovacaoDaSessao(), 0);
    }
  });

  return () => {
    data.subscription.unsubscribe();
    pararRenovacaoDaSessao();
  };
}

let sessaoEmAndamento: Promise<string> | null = null;

/**
 * Garante uma sessão e devolve o ID do usuário.
 * Reaproveita a sessão salva; só faz login anônimo se não houver nenhuma.
 * Chamadas simultâneas recebem a MESMA promessa.
 */
export function garantirSessaoAnonima(): Promise<string> {
  if (!sessaoEmAndamento) {
    sessaoEmAndamento = (async () => {
      const supabase = obterSupabase();

      const existente = await obterIdDaSessaoAtual();
      if (existente) {
        iniciarRenovacaoDaSessao();
        return existente;
      }

      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.user) throw converterErroAuth(error);

      iniciarRenovacaoDaSessao();
      return data.user.id;
    })().catch((erro: unknown) => {
      // Permite nova tentativa; a sessão salva (se houver) não é apagada.
      sessaoEmAndamento = null;
      throw erro;
    });
  }
  return sessaoEmAndamento;
}

/** Apelido do participante da sessão atual (null se não houver sessão ou cadastro). */
export async function obterMeuApelido(): Promise<string | null> {
  const id = await obterIdDaSessaoAtual();
  if (!id) return null;
  const { data, error } = await obterSupabase()
    .from('participantes')
    .select('apelido')
    .eq('id', id)
    .maybeSingle();
  if (error) throw converterErroBanco(error);
  return data ? (data as { apelido: string }).apelido : null;
}

async function atualizarCadastro(id: string, dados: CadastroParticipante): Promise<void> {
  const { data, error } = await obterSupabase()
    .from('participantes')
    .update({ apelido: dados.apelido, cidade: dados.cidade, idade: dados.idade })
    .eq('id', id)
    .select('id');
  if (error) throw converterErroBanco(error);
  if (!data || data.length !== 1) {
    throw new ErroIdentidade('nao_permitido', 'Não foi possível atualizar seu cadastro.');
  }
}

/**
 * Salva apelido, cidade e idade do participante no Supabase.
 * Faz o login anônimo (sob demanda) se ainda não houver sessão.
 * Fluxo: SELECT da própria linha -> UPDATE se existir, senão INSERT
 * (se o INSERT colidir com outra tentativa simultânea, faz UPDATE).
 */
export async function salvarCadastroSupabase(dados: CadastroParticipante): Promise<void> {
  const id = await garantirSessaoAnonima();
  const supabase = obterSupabase();

  const { data: existente, error: erroLeitura } = await supabase
    .from('participantes')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (erroLeitura) throw converterErroBanco(erroLeitura);

  if (existente) {
    await atualizarCadastro(id, dados);
    return;
  }

  const { error: erroInsercao } = await supabase
    .from('participantes')
    .insert({ id, apelido: dados.apelido, cidade: dados.cidade, idade: dados.idade });

  if (!erroInsercao) return;
  if (erroInsercao.code === '23505') {
    // Outra tentativa criou a linha ao mesmo tempo: atualiza em vez de duplicar.
    await atualizarCadastro(id, dados);
    return;
  }
  throw converterErroBanco(erroInsercao);
}

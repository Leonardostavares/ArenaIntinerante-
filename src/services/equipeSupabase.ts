import type { AuthError, PostgrestError } from '@supabase/supabase-js';
import { obterSupabase } from '../lib/supabase';

/**
 * Autenticação da equipe (staff) no Supabase.
 *
 * Diferente do participante (login anônimo), a equipe entra com e-mail e
 * senha, cadastrados manualmente no painel do Supabase. Depois do login,
 * confirmamos que o usuário está em public.membros_equipe (RLS só deixa
 * cada um ver a própria linha) antes de liberar o painel.
 *
 * Se o login funcionar mas o usuário NÃO estiver em membros_equipe, a
 * sessão é encerrada (signOut): credenciais válidas não bastam, é preciso
 * ser membro da equipe.
 */

export type CodigoErroEquipe = 'credenciais_invalidas' | 'nao_e_equipe' | 'rede' | 'limite' | 'servidor';

/** Erro de autenticação/autorização da equipe. A mensagem é segura para exibir. */
export class ErroEquipe extends Error {
  readonly codigo: CodigoErroEquipe;
  readonly causa?: unknown;

  constructor(codigo: CodigoErroEquipe, mensagem: string, causa?: unknown) {
    super(mensagem);
    this.name = 'ErroEquipe';
    this.codigo = codigo;
    this.causa = causa;
  }
}

function ehFalhaDeRede(mensagem: string | undefined): boolean {
  return /network request failed|failed to fetch|network/i.test(mensagem ?? '');
}

function converterErroAuth(erro: AuthError | null): ErroEquipe {
  if (!erro) {
    return new ErroEquipe('servidor', 'Não foi possível entrar. Tente novamente.');
  }
  if (erro.status === 429) {
    return new ErroEquipe('limite', 'Muitas tentativas agora. Aguarde alguns minutos e tente de novo.', erro);
  }
  if (erro.code === 'invalid_credentials') {
    return new ErroEquipe('credenciais_invalidas', 'E-mail ou senha incorretos.', erro);
  }
  if (erro.name === 'AuthRetryableFetchError' || erro.status === 0 || ehFalhaDeRede(erro.message)) {
    return new ErroEquipe('rede', 'Sem conexão com a internet. Verifique e tente novamente.', erro);
  }
  return new ErroEquipe('servidor', 'Não foi possível entrar. Tente novamente.', erro);
}

function converterErroBanco(erro: PostgrestError): ErroEquipe {
  if (!erro.code && ehFalhaDeRede(erro.message)) {
    return new ErroEquipe('rede', 'Sem conexão com a internet. Verifique e tente novamente.', erro);
  }
  return new ErroEquipe('servidor', 'Não foi possível confirmar seu acesso. Tente novamente.', erro);
}

/**
 * Autentica um membro da equipe por e-mail e senha, e confirma a
 * participação em public.membros_equipe antes de liberar o acesso.
 * Lança ErroEquipe em qualquer falha (credenciais, rede ou "não é da equipe").
 * Se o login funcionar mas o usuário não for da equipe, a sessão é encerrada.
 */
export async function entrarComoEquipe(email: string, senha: string): Promise<void> {
  const supabase = obterSupabase();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user) throw converterErroAuth(error);

  const { data: membro, error: erroConsulta } = await supabase
    .from('membros_equipe')
    .select('papel')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (erroConsulta) {
    await supabase.auth.signOut();
    throw converterErroBanco(erroConsulta);
  }

  if (!membro) {
    await supabase.auth.signOut();
    throw new ErroEquipe('nao_e_equipe', 'Este usuário não faz parte da equipe.');
  }
}

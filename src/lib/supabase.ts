import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';

/**
 * Cliente Supabase do ArenaIntinerante.
 *
 * - URL e chave vêm de variáveis PÚBLICAS (EXPO_PUBLIC_*), embutidas no app.
 *   Somente a publishable key é aceita; a proteção dos dados é feita pelo RLS.
 *   NUNCA usar service_role ou chave secreta no aplicativo.
 * - O cliente é criado sob demanda (obterSupabase) e só depois de validar a
 *   configuração. Se as variáveis estiverem ausentes ou inválidas, nenhuma
 *   conexão é criada e um ErroConfiguracaoSupabase é lançado.
 * - A sessão fica persistida no aparelho, exclusivamente no AsyncStorage
 *   (@react-native-async-storage/async-storage).
 */

/** URL do projeto: exatamente https://<referência de 20 caracteres>.supabase.co */
const FORMATO_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/;

/** Somente a publishable key (pública). Chaves secretas e JWTs são recusados. */
const FORMATO_CHAVE_PUBLICA = /^sb_publishable_[A-Za-z0-9_-]{10,}$/;

export type CodigoErroConfiguracao = 'url_ausente' | 'url_invalida' | 'chave_ausente' | 'chave_invalida';

/** Configuração ausente ou inválida. A mensagem nunca inclui os valores. */
export class ErroConfiguracaoSupabase extends Error {
  readonly codigo: CodigoErroConfiguracao;

  constructor(codigo: CodigoErroConfiguracao, mensagem: string) {
    super(mensagem);
    this.name = 'ErroConfiguracaoSupabase';
    this.codigo = codigo;
  }
}

type ConfiguracaoSupabase = { url: string; chavePublica: string };

function lerConfiguracao(): ConfiguracaoSupabase {
  // Acesso com ponto (process.env.EXPO_PUBLIC_...): é a única forma que o
  // Expo substitui pelo valor no momento do build.
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const chavePublica = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

  if (!url) {
    throw new ErroConfiguracaoSupabase('url_ausente', 'EXPO_PUBLIC_SUPABASE_URL não está configurada.');
  }
  if (!FORMATO_URL.test(url)) {
    throw new ErroConfiguracaoSupabase(
      'url_invalida',
      'EXPO_PUBLIC_SUPABASE_URL deve ser https://<referência do projeto>.supabase.co.'
    );
  }
  if (!chavePublica) {
    throw new ErroConfiguracaoSupabase(
      'chave_ausente',
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY não está configurada.'
    );
  }
  if (!FORMATO_CHAVE_PUBLICA.test(chavePublica)) {
    throw new ErroConfiguracaoSupabase(
      'chave_invalida',
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY deve ser uma publishable key (sb_publishable_...).'
    );
  }

  return { url: url.replace(/\/$/, ''), chavePublica };
}

let cliente: SupabaseClient | null = null;

/**
 * Devolve o cliente Supabase (criado uma única vez).
 * Lança ErroConfiguracaoSupabase se a configuração for inválida; nesse caso
 * nenhum cliente é criado e a próxima chamada tenta de novo.
 */
export function obterSupabase(): SupabaseClient {
  if (!cliente) {
    const { url, chavePublica } = lerConfiguracao();
    cliente = createClient(url, chavePublica, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return cliente;
}

let assinaturaEstadoDoApp: NativeEventSubscription | null = null;

/**
 * Liga a renovação automática da sessão enquanto o app está em primeiro plano
 * e a desliga quando vai para o fundo (recomendação do guia Expo + Supabase).
 * Ainda NÃO é chamada em nenhuma tela; será ativada numa etapa futura.
 * Devolve a função que desfaz o registro.
 */
export function iniciarRenovacaoDaSessao(): () => void {
  if (assinaturaEstadoDoApp) return pararRenovacaoDaSessao;

  const supabase = obterSupabase();
  const aplicar = (estado: AppStateStatus) => {
    if (estado === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  };

  aplicar(AppState.currentState);
  assinaturaEstadoDoApp = AppState.addEventListener('change', aplicar);
  return pararRenovacaoDaSessao;
}

/** Remove o registro de estado do app e para a renovação automática. */
export function pararRenovacaoDaSessao(): void {
  assinaturaEstadoDoApp?.remove();
  assinaturaEstadoDoApp = null;
  if (cliente) void cliente.auth.stopAutoRefresh();
}

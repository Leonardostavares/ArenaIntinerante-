/**
 * Backend de dados do aplicativo.
 *
 * - 'local'    (padrão): tudo no SQLite do aparelho; NENHUMA conexão com o Supabase.
 * - 'supabase': identidade e cadastro do participante no Supabase
 *               (etapas seguintes migram check-ins e avaliações).
 *
 * Definido por EXPO_PUBLIC_ARENA_BACKEND. Qualquer valor ausente ou
 * desconhecido resulta em 'local' (o lado seguro: sem conexão).
 */
export type BackendDoApp = 'local' | 'supabase';

export function backendDoApp(): BackendDoApp {
  // Acesso com ponto: é a forma que o Expo substitui no momento do build.
  const valor = process.env.EXPO_PUBLIC_ARENA_BACKEND?.trim().toLowerCase();
  return valor === 'supabase' ? 'supabase' : 'local';
}

export function usarSupabase(): boolean {
  return backendDoApp() === 'supabase';
}

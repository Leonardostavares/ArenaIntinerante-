import axios from 'axios';

// TODO: trocar pela URL do projeto Supabase quando a integracao real existir.
export const api = axios.create({
  baseURL: 'https://SEU-PROJETO.supabase.co/rest/v1',
  timeout: 10000,
});

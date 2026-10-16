import axios from 'axios';

export const api = axios.create({
  baseURL: 'https://SEU-PROJETO.supabase.co/rest/v1',
  timeout: 10000,
});

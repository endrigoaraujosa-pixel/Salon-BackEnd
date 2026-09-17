import { getTenantSchema } from '../config/tenantContext.js';

export function tenantInstance() {
  const tenant = getTenantSchema();
  if (typeof tenant !== 'string' || !/^company_[a-z0-9_-]+$/.test(tenant)) throw new Error('Empresa inválida.');
  return tenant.slice('company_'.length);
}
const cleanUrl = value => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('URL da integração inválida.');
  }
  return url.href.replace(/\/+$/, '');
};
export function evolutionConnection(config = {}) {
  const serverUrl = process.env.EVOLUTION_API_URL ? cleanUrl(process.env.EVOLUTION_API_URL) : '';
  const requested = String(config.api_url || '').trim();
  const baseUrl = !requested || ['external', 'local'].includes(requested) ? serverUrl : cleanUrl(requested);
  const allowed = [serverUrl, ...(process.env.EVOLUTION_ALLOWED_URLS || '').split(',').filter(Boolean).map(value => cleanUrl(value.trim()))];
  if (!baseUrl || !allowed.includes(baseUrl)) throw new Error('URL da integração não autorizada pelo servidor.');
  const instance = String(config.instancia || '');
  if (!/^[a-zA-Z0-9_-]+$/.test(instance)) throw new Error('Instância inválida.');
  const useServerKey = baseUrl === serverUrl && Boolean(process.env.EVOLUTION_API_TOKEN);
  if (useServerKey && instance !== tenantInstance()) throw new Error('Instância não pertence a esta empresa.');
  return { baseUrl, instance: encodeURIComponent(instance), apiKey: String(useServerKey ? process.env.EVOLUTION_API_TOKEN : config.token || '').trim() };
}
export function publicWhatsappConfig(config) {
  if (!config) return config;
  const value = config.toJSON ? config.toJSON() : { ...config };
  delete value.token;
  return value;
}

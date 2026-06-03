import { AsyncLocalStorage } from 'async_hooks';
export const tenantStorage = new AsyncLocalStorage();

export const getTenantSchema = () => {
  return tenantStorage.getStore();
};

import { AsyncLocalStorage } from 'async_hooks';
export const tenantStorage = new AsyncLocalStorage();

export const getTenantSchema = () => {
  console.log("tenantStorage", tenantStorage.getStore());  
  return tenantStorage.getStore();
};

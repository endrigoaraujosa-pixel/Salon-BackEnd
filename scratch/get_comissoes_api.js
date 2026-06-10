import { tenantStorage } from '../src/config/tenantContext.js';
import { listComissoes } from '../src/controllers/comissaoController.js';

// Mock response object
const mockRes = {
  json(data) {
    console.log(JSON.stringify(data, null, 2));
  },
  status(code) {
    console.log("STATUS CODE:", code);
    return this;
  }
};

const mockReq = {
  query: {
    mes: '2026-06',
    status: 'todos'
  }
};

async function main() {
  try {
    await tenantStorage.run('company_salon', async () => {
      await listComissoes(mockReq, mockRes);
    });
  } catch (error) {
    console.error(error);
  }
}

main();

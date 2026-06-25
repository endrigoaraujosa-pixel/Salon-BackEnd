import { sequelize } from './src/config/db.js';
import { tenantStorage } from './src/config/tenantContext.js';
import { getTaxaCartaoModel } from './src/models/TaxaCartao.js';
import { getAdquirenteModel } from './src/models/Adquirente.js';

async function run() {
  await tenantStorage.run('company_salon', async () => {
    try {
      await sequelize.authenticate();
      const Taxa = getTaxaCartaoModel();
      const Adq = getAdquirenteModel();
      
      const rates = await Taxa.findAll({ where: { deletado: 'N' } });
      const adquirentes = await Adq.findAll({ where: { deletado: 'N' } });
      
      console.log('--- Active and Non-Deleted Rates ---');
      rates.forEach(r => {
        console.log(`Forma: ${r.forma_pagamento}, Descricao: ${r.descricao}, Ativo: ${r.ativo}, AdquirenteID: ${r.adquirente_id}`);
      });
      
      console.log('\n--- Active and Non-Deleted Adquirentes ---');
      adquirentes.forEach(a => {
        console.log(`ID: ${a.id}, Descricao: ${a.descricao}, Ativo: ${a.ativo}`);
      });
    } catch (e) {
      console.error(e);
    } finally {
      await sequelize.close();
    }
  });
}

run();

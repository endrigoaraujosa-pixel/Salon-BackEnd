import { sequelize } from './src/config/db.js';
import { tenantStorage } from './src/config/tenantContext.js';
import { getUserModel } from './src/models/User.js';

async function run() {
  await tenantStorage.run('company_salon', async () => {
    try {
      await sequelize.authenticate();
      const User = getUserModel();
      
      const users = await User.findAll({ where: { deletado: 'N' } });
      
      console.log('--- Active Users ---');
      users.forEach(u => {
        console.log(`Name: ${u.name}, Email: ${u.email}, Role: ${u.role}, PerfilAcessoID: ${u.perfil_acesso_id}, pode_excluir_agendamento: ${u.pode_excluir_agendamento}, pode_excluir_pagamento: ${u.pode_excluir_pagamento}`);
      });
    } catch (e) {
      console.error(e);
    } finally {
      await sequelize.close();
    }
  });
}

run();

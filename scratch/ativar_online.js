import { sequelize } from '../src/config/db.js';
import { tenantStorage } from '../src/config/tenantContext.js';
import { getConfiguracaoSistemaModel } from '../src/models/ConfiguracaoSistema.js';

async function run() {
  await tenantStorage.run('company_salon', async () => {
    try {
      await sequelize.authenticate();
      const Config = getConfiguracaoSistemaModel();
      
      let config = await Config.findOne();
      if (!config) {
        config = await Config.create({
          bloquear_valor_agendamento_menor: false,
          permitir_estoque_negativo: false,
          permitir_cliente_duplicado: false,
          descontar_taxa_cartao_comissao: false,
          trabalhar_credito_cliente: false,
          agendamento_online_ativo: true
        });
        console.log('Configurações criadas com agendamento online ATIVO.');
      } else {
        config.agendamento_online_ativo = true;
        await config.save();
        console.log('Configurações atualizadas: Agendamento online ATIVADO.');
      }
    } catch (e) {
      console.error('Erro ao ativar agendamento online:', e);
    } finally {
      await sequelize.close();
    }
  });
}

run();

import { sequelize } from './config/db.js';
import Agendamento from './models/Agendamento.js';

async function runMigration() {
  try {
    console.log('Iniciando migração de comissões auxiliares...');
    const agendamentos = await Agendamento.findAll({
      where: {
        status: 'concluido',
        deletado: 'N'
      }
    });

    let updatedCount = 0;
    for (const ag of agendamentos) {
      let itens = [];
      let updated = false;
      try {
        itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
      } catch (e) {
        itens = ag.itens || [];
      }

      if (Array.isArray(itens)) {
        itens = itens.map(item => {
          const temAux = !!(item.auxiliar_id && String(item.auxiliar_id).trim() !== "" && String(item.auxiliar_id).trim() !== "null" && String(item.auxiliar_id).trim() !== "undefined" && String(item.auxiliar_id).trim() !== "none");
          if (temAux && item.comissao_paga_auxiliar === undefined) {
            // Inicializar com o valor atual de comissao_paga para manter o histórico correto
            item.comissao_paga_auxiliar = !!item.comissao_paga;
            updated = true;
          }
          return item;
        });

        if (updated) {
          ag.itens = itens;
          ag.changed('itens', true);
          await ag.save();
          updatedCount++;
        }
      }
    }

    console.log(`Migração concluída com sucesso! ${updatedCount} agendamentos foram atualizados.`);
    process.exit(0);
  } catch (error) {
    console.error('Erro na migração:', error);
    process.exit(1);
  }
}

runMigration();

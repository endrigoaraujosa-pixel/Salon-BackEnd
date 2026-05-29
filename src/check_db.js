import { sequelize } from './config/db.js';
import Agendamento from './models/Agendamento.js';

async function runCheck() {
  try {
    const agendamentos = await Agendamento.findAll({
      where: {
        status: 'concluido',
        deletado: 'N'
      }
    });

    console.log(`Total de agendamentos concluídos: ${agendamentos.length}`);
    for (const ag of agendamentos) {
      let itens = [];
      try {
        itens = typeof ag.itens === 'string' ? JSON.parse(ag.itens) : ag.itens;
      } catch (e) {
        itens = ag.itens || [];
      }
      console.log(`Agendamento #${ag.numero}:`, JSON.stringify(itens));
    }
    process.exit(0);
  } catch (error) {
    console.error('Erro:', error);
    process.exit(1);
  }
}

runCheck();

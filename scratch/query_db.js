import { sequelize } from '../src/config/db.js';

async function main() {
  try {
    const [agendamentos] = await sequelize.query('SELECT id, numero, status, itens FROM company_salon.agendamentos WHERE status = \'concluido\' AND deletado = \'N\'');
    console.log("AGENDAMENTOS:");
    console.log(JSON.stringify(agendamentos, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await sequelize.close();
  }
}

main();

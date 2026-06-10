import { sequelize, connectDB } from './config/db.js';
import { tenantStorage } from './config/tenantContext.js';
import { getAgendamentoModel } from './models/Agendamento.js';

async function run() {
  await connectDB();
  const schema = 'company_salon';
  await tenantStorage.run(schema, async () => {
    const agends = await getAgendamentoModel().findAll({
      order: [['createdAt', 'DESC']],
      limit: 3
    });
    console.log("=== APPOINTMENTS ===");
    for (const ag of agends) {
      console.log(`ID: ${ag.id} | Numero: ${ag.numero} | Status: ${ag.status} | Itens: ${JSON.stringify(ag.itens, null, 2)}`);
    }
  });
  process.exit(0);
}

run();

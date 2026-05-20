import { sequelize } from './src/config/db.js';
import Servico from './src/models/Servico.js';

async function run() {
  try {
    console.log("Creating new test service...");
    const s1 = await Servico.create({
      nome: "Servico Teste Prods",
      valor: 50,
      duracao_minutos: 30,
      produtos_vinculados: [
        { produto_id: "some-prod-id", quantidade: 2.5 }
      ]
    });
    console.log("Created successfully! Data in memory:", JSON.stringify(s1.toJSON(), null, 2));

    // Read directly from DB using raw query to see exactly what is stored!
    const [rawRows] = await sequelize.query("SELECT * FROM servicos WHERE id = :id", {
      replacements: { id: s1.id }
    });
    console.log("Raw DB content:", JSON.stringify(rawRows, null, 2));

    console.log("Updating service...");
    await s1.update({
      produtos_vinculados: [
        { produto_id: "some-prod-id", quantidade: 5.0 },
        { produto_id: "other-prod-id", quantidade: 1.0 }
      ]
    });
    console.log("Updated successfully! Data in memory:", JSON.stringify(s1.toJSON(), null, 2));

    const [rawRowsUpdated] = await sequelize.query("SELECT * FROM servicos WHERE id = :id", {
      replacements: { id: s1.id }
    });
    console.log("Raw DB content after update:", JSON.stringify(rawRowsUpdated, null, 2));

    // Cleanup
    await s1.destroy();
    console.log("Cleanup finished.");

  } catch (err) {
    console.error("ERROR IN TEST:", err);
  }
  process.exit(0);
}
run();

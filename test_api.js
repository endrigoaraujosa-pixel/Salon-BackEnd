import { sequelize } from './src/config/db.js';
import User from './src/models/User.js';
import Servico from './src/models/Servico.js';
import jwt from 'jsonwebtoken';

async function run() {
  try {
    console.log("Generating admin token for API test...");
    const admin = await User.findOne({ where: { role: 'admin' } });
    if (!admin) {
      console.error("No admin user found. Seed the admin first.");
      process.exit(1);
    }

    const token = jwt.sign({ id: admin.id }, process.env.JWT_SECRET || 'secret123', { expiresIn: '1d' });
    console.log("Token generated:", token);

    // Let's create a service via Sequelize raw first
    const testServ = await Servico.create({
      nome: "Servico API Test",
      valor: 80,
      duracao_minutos: 45,
      produtos_vinculados: [{ produto_id: "p1", quantidade: 3 }]
    });
    console.log("Initially created via Sequelize direct:", JSON.stringify(testServ.toJSON(), null, 2));

    // Now let's simulate the controller req and res for updateServ!
    // We will import updateServ from servicoController.js and call it with mock req and res
    const { updateServ } = await import('./src/controllers/servicoController.js');
    
    let mockResJson = null;
    let mockStatus = null;

    const req = {
      params: { sid: testServ.id },
      body: {
        nome: "Servico API Test Updated",
        valor: 90,
        duracao_minutos: 50,
        produtos_vinculados: [{ produto_id: "p1", quantidade: 10 }, { produto_id: "p2", quantidade: 5 }]
      }
    };

    const res = {
      status(s) {
        mockStatus = s;
        return this;
      },
      json(data) {
        mockResJson = data;
        return this;
      }
    };

    console.log("Simulating controller updateServ call...");
    await updateServ(req, res);

    console.log("Response status:", mockStatus);
    console.log("Response JSON:", JSON.stringify(mockResJson, null, 2));

    // Let's query the database to verify if it actually saved the updated products!
    const reloaded = await Servico.findByPk(testServ.id);
    console.log("Reloaded from DB:", JSON.stringify(reloaded.toJSON(), null, 2));

    // Cleanup
    await testServ.destroy();
    console.log("Cleanup finished.");

  } catch (err) {
    console.error("API test crashed:", err);
  }
  process.exit(0);
}
run();

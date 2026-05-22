import { connectDB, sequelize } from './src/config/db.js';
import Produto from './src/models/Produto.js';

async function run() {
  await connectDB();
  
  const id = '3ac174d2-7bcf-4c35-a16c-974a7d028430';
  
  // Teste 1: findByPk
  const p1 = await Produto.findByPk(id);
  console.log('findByPk:', p1 ? p1.nome : 'NULL');
  
  // Teste 2: findOne
  const p2 = await Produto.findOne({ where: { id } });
  console.log('findOne:', p2 ? p2.nome : 'NULL');

  // Teste 3: Query SQL direto
  const [rows] = await sequelize.query(`SELECT id, nome, deletado FROM produtos WHERE id = '${id}'`);
  console.log('SQL direto:', rows);

  // Teste 4: Verificar qual tableName o modelo usa
  console.log('tableName:', Produto.tableName || Produto.getTableName());

  await sequelize.close();
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });

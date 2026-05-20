import Despesa from './src/models/Despesa.js';
import { connectDB } from './src/config/db.js';

async function run() {
  await connectDB();
  const count = await Despesa.count();
  const all = await Despesa.findAll();
  console.log('COUNT:', count);
  console.log('DESPESAS:', JSON.stringify(all, null, 2));
  process.exit(0);
}
run();

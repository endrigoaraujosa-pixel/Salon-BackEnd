import Despesa from './src/models/Despesa.js';
import { connectDB } from './src/config/db.js';

async function test() {
  await connectDB();
  try {
    const d = await Despesa.create({
      descricao: 'Teste Gasto',
      valor: 150.00,
      tipo: 'fixo',
      categoria: 'Aluguel',
      data_vencimento: '2026-05-20',
      pago: true
    });
    console.log('SUCCESS:', d.toJSON());
  } catch (error) {
    console.error('ERROR:', error);
  }
  process.exit(0);
}

test();

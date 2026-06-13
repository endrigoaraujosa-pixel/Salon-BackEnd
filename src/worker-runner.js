import 'dotenv/config';
import { connectDB } from './config/db.js';
import { startReminderJob } from './jobs/whatsapp-reminder.job.js';

async function start() {
  console.log('[Worker] Iniciando serviço de background worker...');
  try {
    await connectDB();
    console.log('[Worker] Banco de dados conectado com sucesso.');
    
    // Inicia o loop de Lembretes do WhatsApp
    startReminderJob();
    
    console.log('[Worker] Job de Lembretes agendado e rodando (intervalo: 60s).');
  } catch (error) {
    console.error('[Worker] Erro crítico ao iniciar o worker:', error);
    process.exit(1);
  }
}

start();

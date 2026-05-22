import { sequelize } from './src/config/db.js';

async function run() {
  try {
    await sequelize.authenticate();
    console.log('Conectado ao banco.');

    // Verificar se a coluna já existe
    const [cols] = await sequelize.query("PRAGMA table_info(vendas_diretas)");
    const colNames = cols.map(c => c.name);
    console.log('Colunas atuais:', colNames.join(', '));

    if (!colNames.includes('itens')) {
      await sequelize.query("ALTER TABLE vendas_diretas ADD COLUMN itens TEXT DEFAULT '[]'");
      console.log('✅ Coluna "itens" adicionada com sucesso!');
    } else {
      console.log('ℹ️ Coluna "itens" já existe, nada a fazer.');
    }

    // Verificar resultado
    const [cols2] = await sequelize.query("PRAGMA table_info(vendas_diretas)");
    console.log('Colunas após migração:', cols2.map(c => c.name).join(', '));

  } catch (e) {
    console.error('Erro:', e.message);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

run();

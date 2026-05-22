import { connectDB, sequelize } from './src/config/db.js';
import Servico from './src/models/Servico.js';

async function test() {
  try {
    await connectDB();
    
    // 1. Buscar serviços deletados
    const deletados = await Servico.findAll({ where: { deletado: 'S' } });
    console.log(`\n=== Serviços deletados: ${deletados.length} ===`);
    
    if (deletados.length === 0) {
      console.log('Nenhum serviço deletado. Criando um para teste...');
      const novo = await Servico.create({
        nome: 'TESTE_RESTAURAR',
        valor: 50,
        duracao_minutos: 30,
        deletado: 'S',
        deletado_por: 'teste',
        deletado_em: new Date()
      });
      deletados.push(novo);
      console.log('Serviço de teste criado:', novo.id);
    }
    
    const testServ = deletados[0];
    console.log('\n--- Testando restauração ---');
    console.log('ID:', testServ.id);
    console.log('Nome:', testServ.nome);
    console.log('deletado:', testServ.deletado);
    console.log('produtos_vinculados raw:', testServ.getDataValue('produtos_vinculados'));
    console.log('produtos_vinculados get:', testServ.produtos_vinculados);
    
    // 2. Tentar restaurar (mesma lógica do auditController.restoreRecord)
    try {
      await testServ.update({
        deletado: 'N',
        deletado_por: null,
        deletado_em: null
      });
      console.log('\n✅ RESTAURAÇÃO BEM SUCEDIDA');
      console.log('deletado agora:', testServ.deletado);
    } catch (e) {
      console.error('\n❌ ERRO NA RESTAURAÇÃO:', e.message);
      console.error('Stack:', e.stack?.substring(0, 800));
    }
    
    // 3. Reverter (re-deletar para não poluir)
    if (testServ.nome === 'TESTE_RESTAURAR') {
      await testServ.destroy();
      console.log('Registro de teste removido.');
    } else {
      await testServ.update({
        deletado: 'S',
        deletado_por: 'teste_rollback',
        deletado_em: new Date()
      });
      console.log('Registro revertido para deletado.');
    }
    
  } catch (e) {
    console.error('ERRO GERAL:', e.message);
    console.error('Stack:', e.stack?.substring(0, 800));
  } finally {
    process.exit(0);
  }
}

test();

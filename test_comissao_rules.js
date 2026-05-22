import { connectDB, sequelize } from './src/config/db.js';
import Colaborador from './src/models/Colaborador.js';
import Agendamento from './src/models/Agendamento.js';
import { v4 as uuidv4 } from 'uuid';

async function run() {
  await connectDB();
  console.log('--- Teste de Regras de Comissão ---');

  // 1. Criar dois colaboradores de teste
  const colabPrincipal = await Colaborador.create({
    nome: 'Profissional Principal Teste',
    comissao_sozinho: 50,
    comissao_ajuda: 35,
    comissao_auxiliar: 15,
    ativo: true
  });

  const colabAuxiliar = await Colaborador.create({
    nome: 'Assistente Teste',
    comissao_sozinho: 45,
    comissao_ajuda: 30,
    comissao_auxiliar: 20,
    ativo: true
  });

  console.log('Colaboradores de teste criados com sucesso.');
  console.log(`Principal: Sozinho 50%, Com ajuda 35%, Auxiliar 15%`);
  console.log(`Auxiliar: Sozinho 45%, Com ajuda 30%, Auxiliar 20%`);

  // Simular as regras de comissão exatamente como no comissaoController
  const calcularComissao = (colab, item) => {
    if (item.colaborador_id === colab.id) {
      const val_serv = Number(item.valor || 0);
      const temAuxiliar = !!(item.auxiliar_id && String(item.auxiliar_id).trim() !== "" && String(item.auxiliar_id).trim() !== "null" && String(item.auxiliar_id).trim() !== "undefined");
      const pct = temAuxiliar
        ? Number(colab.comissao_ajuda != null ? colab.comissao_ajuda : 30)
        : Number(colab.comissao_sozinho != null ? colab.comissao_sozinho : (colab.comissao_principal || 0));
      return {
        papel: temAuxiliar ? 'Principal (Com ajuda)' : 'Principal (Sozinho)',
        percentual: pct,
        comissao: val_serv * (pct / 100)
      };
    }
    if (item.auxiliar_id === colab.id) {
      const val_serv = Number(item.valor || 0);
      const pct = Number(colab.comissao_auxiliar || 0);
      return {
        papel: 'Auxiliar',
        percentual: pct,
        comissao: val_serv * (pct / 100)
      };
    }
    return null;
  };

  // Cenário 1: Serviço executado SOZINHO pelo Profissional Principal
  const itemSolo = {
    servico_id: 's1',
    nome: 'Corte Masculino',
    valor: 100.00,
    colaborador_id: colabPrincipal.id,
    auxiliar_id: null
  };
  
  const resSolo = calcularComissao(colabPrincipal, itemSolo);
  console.log('\nCenário 1 (Sozinho):');
  console.log(`- Papel: ${resSolo.papel}`);
  console.log(`- Percentual Aplicado: ${resSolo.percentual}%`);
  console.log(`- Comissão Calculada: R$ ${resSolo.comissao.toFixed(2)}`);
  if (resSolo.percentual === 50 && resSolo.comissao === 50.00) {
    console.log('✔ Cenário 1 passou no teste!');
  } else {
    console.error('❌ Cenário 1 falhou no teste!');
  }

  // Cenário 2: Serviço executado COM AJUDA pelo Profissional Principal
  const itemComAjuda = {
    servico_id: 's2',
    nome: 'Coloração',
    valor: 200.00,
    colaborador_id: colabPrincipal.id,
    auxiliar_id: colabAuxiliar.id
  };

  const resComAjuda = calcularComissao(colabPrincipal, itemComAjuda);
  console.log('\nCenário 2 (Com ajuda):');
  console.log(`- Papel: ${resComAjuda.papel}`);
  console.log(`- Percentual Aplicado: ${resComAjuda.percentual}%`);
  console.log(`- Comissão Calculada: R$ ${resComAjuda.comissao.toFixed(2)}`);
  if (resComAjuda.percentual === 35 && resComAjuda.comissao === 70.00) {
    console.log('✔ Cenário 2 passou no teste!');
  } else {
    console.error('❌ Cenário 2 falhou no teste!');
  }

  // Cenário 3: Profissional Auxiliar atuando como assistente
  const resAuxiliar = calcularComissao(colabAuxiliar, itemComAjuda);
  console.log('\nCenário 3 (Atuando como assistente):');
  console.log(`- Papel: ${resAuxiliar.papel}`);
  console.log(`- Percentual Aplicado: ${resAuxiliar.percentual}%`);
  console.log(`- Comissão Calculada: R$ ${resAuxiliar.comissao.toFixed(2)}`);
  if (resAuxiliar.percentual === 20 && resAuxiliar.comissao === 40.00) {
    console.log('✔ Cenário 3 passou no teste!');
  } else {
    console.error('❌ Cenário 3 falhou no teste!');
  }

  // Limpeza
  await colabPrincipal.destroy();
  await colabAuxiliar.destroy();
  console.log('\nColaboradores de teste limpos da base.');

  await sequelize.close();
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});

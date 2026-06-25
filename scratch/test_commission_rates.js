import { sequelize } from '../src/config/db.js';
import { tenantStorage } from '../src/config/tenantContext.js';
import { getClienteModel } from '../src/models/Cliente.js';
import { getColaboradorModel } from '../src/models/Colaborador.js';
import { getProdutoModel } from '../src/models/Produto.js';
import { getServicoModel } from '../src/models/Servico.js';
import { getAgendamentoModel } from '../src/models/Agendamento.js';
import { getPagamentoModel } from '../src/models/Pagamento.js';
import { getConfiguracaoSistemaModel } from '../src/models/ConfiguracaoSistema.js';
import { recalculateAndFreezeCommissions } from '../src/controllers/agendamentoController.js';
import { QueryTypes } from 'sequelize';

async function run() {
  await tenantStorage.run('company_salon', async () => {
    const transaction = await sequelize.transaction();
    try {
      await sequelize.authenticate();
      console.log('Database connected successfully for test.');

      // 1. Configure system config for card deduction = true
      const [sysConfig] = await sequelize.query(
        `SELECT * FROM company_salon.configuracao_sistema LIMIT 1;`,
        { type: QueryTypes.SELECT, transaction }
      );
      
      await sequelize.query(
        `UPDATE company_salon.configuracao_sistema SET descontar_taxa_cartao_comissao = true;`,
        { transaction }
      );

      // 2. Setup mock client
      const Cliente = getClienteModel();
      const mockCliente = await Cliente.create({
        id: 'test-cliente-id',
        nome: 'Test Cliente',
        deletado: 'N'
      }, { transaction });

      // 3. Setup mock collaborator
      const Colab = getColaboradorModel();
      const colabPrincipal = await Colab.create({
        id: 'test-colab-principal',
        nome: 'Test Colab Principal',
        comissao_principal: 50,
        comissao_sozinho: 50,
        comissao_ajuda: 40,
        comissao_auxiliar: 20,
        ativo: true,
        deletado: 'N'
      }, { transaction });

      const colabAuxiliar = await Colab.create({
        id: 'test-colab-auxiliar',
        nome: 'Test Colab Auxiliar',
        comissao_auxiliar: 10,
        ativo: true,
        deletado: 'N'
      }, { transaction });

      // 4. Setup mock product (insumo) - Custo Insumo = 10
      const Prod = getProdutoModel();
      const mockProduct = await Prod.create({
        id: 'test-prod-insumo',
        nome: 'Test Product Insumo',
        custo_unitario: 5,
        quantidade_por_unidade: 1,
        deletado: 'N'
      }, { transaction });

      // 5. Setup mock scheduling (Agendamento)
      // Valor Item = 100, Insumos = 2 * 5 = 10
      const Ag = getAgendamentoModel();
      const agendamento = await Ag.create({
        id: 'test-agendamento',
        cliente_id: mockCliente.id,
        valor_total: 100,
        status: 'concluido',
        deletado: 'N',
        data_hora: new Date(),
        itens: [
          {
            servico_id: 'test-servico',
            nome: 'Test Service',
            valor: 100,
            colaborador_id: colabPrincipal.id,
            auxiliar_id: colabAuxiliar.id,
            produtos_utilizados: [
              {
                produto_id: mockProduct.id,
                quantidade: 2,
                custo_proporcional: 5
              }
            ]
          }
        ]
      }, { transaction });

      // 6. Setup payment with card rate (total payment = 100, card fee = 5)
      const Pag = getPagamentoModel();
      const pag = await Pag.create({
        id: 'test-pagamento-card',
        agendamento_id: agendamento.id,
        valor: 100,
        valor_recebido: 100,
        forma_pagamento: 'cartao_credito',
        cartao_taxa_valor: 5,
        deletado: 'N'
      }, { transaction });

      // 7. Run recalculateAndFreezeCommissions
      await recalculateAndFreezeCommissions(agendamento, transaction);
      await agendamento.save({ transaction });

      const principalItem = agendamento.itens[0];
      
      // Asserts:
      // base_comissao_original = 100 - 10 = 90
      // taxa_cartao_descontada = 5
      // base_comissao_final = 90 - 5 = 85
      
      console.log('principalItem base_comissao_original:', principalItem.base_comissao_original);
      console.log('principalItem taxa_cartao_descontada:', principalItem.taxa_cartao_descontada);
      console.log('principalItem base_comissao_final:', principalItem.base_comissao_final);
      
      if (principalItem.base_comissao_original !== 90) {
        throw new Error(`Assertion failed: base_comissao_original should be 90, got ${principalItem.base_comissao_original}`);
      }
      if (principalItem.base_comissao_final !== 85) {
        throw new Error(`Assertion failed: base_comissao_final should be 85, got ${principalItem.base_comissao_final}`);
      }
      if (principalItem.taxa_cartao_descontada !== 5) {
        throw new Error(`Assertion failed: taxa_cartao_descontada should be 5, got ${principalItem.taxa_cartao_descontada}`);
      }

      console.log('All recalculateAndFreezeCommissions base assertions passed!');

      // 8. Test comissao calculation logic
      // Principal: Base (85) * 40% = 34
      const principalPct = colabPrincipal.comissao_ajuda;
      let principalCom = principalItem.base_comissao_final * (principalPct / 100);
      principalCom = Math.max(0, principalCom);

      // Auxiliar: Base (90) * 10% = 9
      const auxiliarPct = colabAuxiliar.comissao_auxiliar;
      let auxiliarCom = principalItem.base_comissao_original * (auxiliarPct / 100);
      auxiliarCom = Math.max(0, auxiliarCom);

      console.log(`Calculated Principal Commission: ${principalCom} (Expected: 34)`);
      console.log(`Calculated Auxiliar Commission: ${auxiliarCom} (Expected: 9)`);

      if (principalCom !== 34) {
        throw new Error(`Assertion failed: Principal Commission should be 34, got ${principalCom}`);
      }
      if (auxiliarCom !== 9) {
        throw new Error(`Assertion failed: Auxiliar Commission should be 9, got ${auxiliarCom}`);
      }

      console.log('All comissao base math calculations passed!');

    } catch (error) {
      console.error('Test failed:', error);
    } finally {
      await transaction.rollback();
      console.log('Transaction rolled back cleanly.');
      await sequelize.close();
    }
  });
}

run();

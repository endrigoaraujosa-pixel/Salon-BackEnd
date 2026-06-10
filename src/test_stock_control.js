import { sequelize, connectDB } from './config/db.js';
import { tenantStorage } from './config/tenantContext.js';
import { getProdutoModel } from './models/Produto.js';
import { getMovimentacaoEstoqueModel } from './models/MovimentacaoEstoque.js';
import { registrarEntrada } from './controllers/estoqueController.js';
import { createVenda, addPagamentos } from './controllers/vendaDiretaController.js';
import { getAgendamentoModel } from './models/Agendamento.js';
import { adjustStock } from './controllers/agendamentoController.js';
import { convertLegacyStock } from '../scripts/convert-legacy-stock.js';
import { getColaboradorModel } from './models/Colaborador.js';

async function runTests() {
  console.log('--- STARTING STOCK CONTROL E2E TESTS ---');
  try {
    await connectDB();
    await convertLegacyStock();
    
    // Use company_teste schema (or first company_ schema found)
    let schema = 'company_teste';
    const schemas = await sequelize.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'company_%' LIMIT 1");
    if (schemas[0] && schemas[0][0]) {
      schema = schemas[0][0].nspname;
    }
    console.log(`Using schema for tests: ${schema}`);

    await tenantStorage.run(schema, async () => {
      // Find collaborator
      const colab = await getColaboradorModel().findOne();
      if (!colab) {
        throw new Error('No collaborator found for test!');
      }

      // 1. Create a clean test product
      const ProdutoModel = getProdutoModel();
      const testProduct = await ProdutoModel.create({
        nome: 'Shampoo Teste Estoque (400ml)',
        categoria: 'Cabelo',
        unidade_medida: 'un',
        unidade_medida_insumo: 'ml',
        quantidade_estoque: 0,
        estoque_minimo: 1,
        custo_unitario: 100.0,
        preco_venda: 150.0,
        quantidade_por_unidade: 0.400, // 0.400 Litros ou 400ml
        ativo: true
      });

      console.log(`Test product created with ID: ${testProduct.id}`);

      // 2. Test stock entry (registrarEntrada)
      // Mocking request and response
      let responseStatus = 0;
      let responseJson = {};
      const reqEntrada = {
        body: {
          numero_nota: `NF-${Date.now()}`,
          serie_nota: '1',
          fornecedor_nome: 'Fornecedor Teste',
          data_entrada: new Date().toISOString().split('T')[0],
          itens: [
            {
              produto_id: testProduct.id,
              quantidade: 10, // 10 packages
              valor_custo: 100.0
            }
          ]
        }
      };
      const resEntrada = {
        status(code) {
          responseStatus = code;
          return this;
        },
        json(data) {
          responseJson = data;
          return this;
        }
      };

      await registrarEntrada(reqEntrada, resEntrada);
      
      // Check results
      const productAfterEntrada = await ProdutoModel.findByPk(testProduct.id);
      const expectedStockAfterEntrada = 10 * 0.400; // 4.0
      console.log(`Stock after entry: ${productAfterEntrada.quantidade_estoque} (Expected: ${expectedStockAfterEntrada})`);
      
      if (Math.abs(productAfterEntrada.quantidade_estoque - expectedStockAfterEntrada) > 0.001) {
        throw new Error('Stock entry multiplier logic failed!');
      }
      console.log('✔ Stock entry test passed.');

      // Check movement logs
      const MovModel = getMovimentacaoEstoqueModel();
      const movs = await MovModel.findAll({ where: { produto_id: testProduct.id } });
      console.log(`Movement entry amount logged: ${movs[0]?.quantidade} (Expected: ${expectedStockAfterEntrada})`);
      if (Math.abs(movs[0]?.quantidade - expectedStockAfterEntrada) > 0.001) {
        throw new Error('Movement log quantity incorrect!');
      }
      console.log('✔ Stock entry movement log test passed.');

      // 3. Test direct sale stock validation & deduction
      let saleResponseStatus = 0;
      let saleResponseJson = {};
      const reqSale = {
        user: { id: 'test-user' },
        body: {
          colaborador_id: colab.id,
          itens: [
            {
              produto_id: testProduct.id,
              quantidade: 2, // 2 packages
              preco_unitario: 150.0,
              subtotal: 300.0
            }
          ]
        }
      };
      const resSale = {
        status(code) {
          saleResponseStatus = code;
          return this;
        },
        json(data) {
          saleResponseJson = data;
          return this;
        }
      };

      await createVenda(reqSale, resSale);
      if (saleResponseStatus >= 400) {
        throw new Error(`Failed to create sale: ${JSON.stringify(saleResponseJson)}`);
      }
      const saleId = saleResponseJson.id;
      console.log(`Sale created successfully with ID: ${saleId}`);

      // Now add payments to trigger stock deduction
      let payResponseStatus = 0;
      let payResponseJson = {};
      const reqPay = {
        params: { id: saleId },
        body: {
          pagamentos: [
            {
              forma_pagamento: 'dinheiro',
              valor: 300.0
            }
          ]
        }
      };
      const resPay = {
        status(code) {
          payResponseStatus = code;
          return this;
        },
        json(data) {
          payResponseJson = data;
          return this;
        }
      };

      await addPagamentos(reqPay, resPay);
      
      // Stock should have decreased by 2 * 0.400 = 0.800
      const productAfterSale = await ProdutoModel.findByPk(testProduct.id);
      const expectedStockAfterSale = 4.0 - (2 * 0.400); // 3.200
      console.log(`Stock after sale: ${productAfterSale.quantidade_estoque} (Expected: ${expectedStockAfterSale})`);
      if (Math.abs(productAfterSale.quantidade_estoque - expectedStockAfterSale) > 0.001) {
        throw new Error('Direct sale stock deduction logic failed!');
      }
      console.log('✔ Direct sale stock deduction test passed.');

      // 4. Test service appointment stock deduction (adjustStock)
      const AgendamentoModel = getAgendamentoModel();
      const mockAgend = await AgendamentoModel.create({
        cliente_id: 'test-cliente',
        data_hora: new Date(),
        status: 'agendado',
        itens: [
          {
            servico_id: 'test-servico',
            produtos_utilizados: [
              {
                produto_id: testProduct.id,
                quantidade: 0.050, // 50ml or 0.050 liters
                quantidade_por_unidade: 0.400
              }
            ]
          }
        ]
      });

      const transaction = await sequelize.transaction();
      await adjustStock(mockAgend, 'deduct', { transaction });
      await transaction.commit();

      const productAfterAgend = await ProdutoModel.findByPk(testProduct.id);
      const expectedStockAfterAgend = 3.200 - 0.050; // 3.150
      console.log(`Stock after appointment consumption: ${productAfterAgend.quantidade_estoque} (Expected: ${expectedStockAfterAgend})`);
      if (Math.abs(productAfterAgend.quantidade_estoque - expectedStockAfterAgend) > 0.001) {
        throw new Error('Service appointment stock adjustment logic failed!');
      }
      console.log('✔ Service appointment stock adjustment test passed.');

      // Cleanup
      await mockAgend.destroy();
      await testProduct.destroy();
      console.log('✔ Cleanup completed successfully.');
    });

    console.log('--- ALL TESTS PASSED SUCCESSFULLY ---');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

runTests();

import { sequelize } from './config/db.js';
import { getDescontoModel } from './models/Desconto.js';
import { getUserModel } from './models/User.js';
import { getVendaDiretaModel } from './models/VendaDireta.js';
import { getAgendamentoModel } from './models/Agendamento.js';
import { getProdutoModel } from './models/Produto.js';
import { getServicoModel } from './models/Servico.js';
import { getColaboradorModel } from './models/Colaborador.js';
import { getClienteModel } from './models/Cliente.js';
import { getPagamentoModel } from './models/Pagamento.js';
import { tenantStorage } from './config/tenantContext.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

import { createDesconto, updateDesconto, deleteDesconto, validarDescontoAutorizacao } from './controllers/descontoController.js';
import { aplicarDescontoVenda, addPagamentos as addVendaPagamentos } from './controllers/vendaDiretaController.js';
import { aplicarDescontoAgendamento, addPagamentos as addAgendamentoPagamentos } from './controllers/agendamentoController.js';
import { listComissoes } from './controllers/comissaoController.js';

// Setup Mock Express Response
function makeMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
    setHeader(name, val) {
      this.headers[name] = val;
      return this;
    }
  };
  return res;
}

// Assert Helper
function assert(condition, message) {
  if (!condition) {
    console.error(`\x1b[31m❌ FAIL: ${message}\x1b[0m`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    console.log(`\x1b[32m✅ PASS: ${message}\x1b[0m`);
  }
}

async function run() {
  const User = getUserModel();
  const Desconto = getDescontoModel();
  const VendaDireta = getVendaDiretaModel();
  const Agendamento = getAgendamentoModel();
  const Produto = getProdutoModel();
  const Servico = getServicoModel();
  const Colaborador = getColaboradorModel();
  const Cliente = getClienteModel();
  const Pagamento = getPagamentoModel();

  console.log("=== STARTING DISCOUNT MODULE VALIDATION ===");
  
  // Track created records to clean up
  const createdUserIds = [];
  const createdDiscountIds = [];
  const createdVendaIds = [];
  const createdAgendamentoIds = [];
  const createdProductIds = [];
  const createdServiceIds = [];
  const createdColabIds = [];
  const createdClienteIds = [];
  
  try {
    // 0. Setup Base Test Data (Colaborador, Cliente, Products, Services, User)
    const testSalt = await bcrypt.genSalt(10);
    const testPasswordHash = await bcrypt.hash("admin123", testSalt);
    
    const adminUser = await User.create({
      id: uuidv4(),
      email: "test_admin@salon.com",
      password_hash: testPasswordHash,
      name: "Admin Test",
      role: "admin",
      ativo: true
    });
    createdUserIds.push(adminUser.id);

    const normalUser = await User.create({
      id: uuidv4(),
      email: "test_user@salon.com",
      password_hash: testPasswordHash,
      name: "User Test",
      role: "funcionario",
      ativo: true
    });
    createdUserIds.push(normalUser.id);

    const colab = await Colaborador.create({
      id: uuidv4(),
      nome: "Test Collaborator",
      comissao_principal: 10,
      comissao_sozinho: 10,
      ativo: true,
      deletado: 'N'
    });
    createdColabIds.push(colab.id);

    const cliente = await Cliente.create({
      id: uuidv4(),
      nome: "Test Client",
      ativo: true,
      deletado: 'N'
    });
    createdClienteIds.push(cliente.id);

    const prodA = await Produto.create({
      id: uuidv4(),
      nome: "Test Product A",
      preco_venda: 100,
      custo_unitario: 20,
      quantidade_estoque: 10,
      comissao: 10,
      deletado: 'N'
    });
    createdProductIds.push(prodA.id);

    const prodB = await Produto.create({
      id: uuidv4(),
      nome: "Test Product B",
      preco_venda: 50,
      custo_unitario: 10,
      quantidade_estoque: 5,
      comissao: 5,
      deletado: 'N'
    });
    createdProductIds.push(prodB.id);

    const servA = await Servico.create({
      id: uuidv4(),
      nome: "Test Service A",
      valor: 100,
      comissao: 10,
      deletado: 'N'
    });
    createdServiceIds.push(servA.id);

    // ==========================================
    // 1. CADASTRO DE DESCONTOS
    // ==========================================
    console.log("\n--- SCENARIO 1: CADASTRO DE DESCONTOS ---");
    
    // Scenario 1.1: Register Percentage Discount
    let req = {
      body: {
        codigo: "TEST_PCT_10",
        descricao: "10% Off",
        tipo: "porcentagem",
        valor: 10,
        ativo: true,
        incide_comissao: true
      }
    };
    let res = makeMockRes();
    await createDesconto(req, res);
    assert(res.statusCode === 201, "Should successfully create percentage discount");
    const pctDiscountId = res.jsonData.id;
    createdDiscountIds.push(pctDiscountId);
    assert(res.jsonData.codigo === "TEST_PCT_10", "Code should be capitalized and trimmed");

    // Scenario 1.2: Register Fixed Discount
    req = {
      body: {
        codigo: "TEST_FIX_20",
        descricao: "R$ 20 Off",
        tipo: "valor_fixo",
        valor: 20,
        ativo: true,
        incide_comissao: false // Does not affect commission
      }
    };
    res = makeMockRes();
    await createDesconto(req, res);
    assert(res.statusCode === 201, "Should successfully create fixed value discount");
    const fixDiscountId = res.jsonData.id;
    createdDiscountIds.push(fixDiscountId);

    // Scenario 1.3: Edit discount
    req = {
      params: { id: pctDiscountId },
      body: {
        codigo: "TEST_PCT_10_UPDATED",
        descricao: "10% Off Updated",
        tipo: "porcentagem",
        valor: 10,
        ativo: true,
        incide_comissao: true
      }
    };
    res = makeMockRes();
    await updateDesconto(req, res);
    assert(res.statusCode === 200, "Should update discount");
    
    // Verify config persistence
    const checkDiscount = await Desconto.findByPk(pctDiscountId);
    assert(checkDiscount.codigo === "TEST_PCT_10_UPDATED", "Config change should persist in DB");
    assert(checkDiscount.incide_comissao === true, "Incide comissão configuration should persist");

    // Scenario 1.4: Deactivate discount
    req = {
      params: { id: pctDiscountId },
      body: {
        codigo: "TEST_PCT_10_UPDATED",
        descricao: "10% Off Updated",
        tipo: "porcentagem",
        valor: 10,
        ativo: false, // DEACTIVATED
        incide_comissao: true
      }
    };
    res = makeMockRes();
    await updateDesconto(req, res);
    assert(res.statusCode === 200, "Should successfully update to inactive");
    assert(res.jsonData.ativo === false, "Discount state should be inactive");

    // Scenario 1.5: Exclude (soft delete) discount
    req = {
      params: { id: pctDiscountId },
      user: { email: "test_admin@salon.com" }
    };
    res = makeMockRes();
    await deleteDesconto(req, res);
    assert(res.statusCode === 200, "Should successfully delete discount");
    const deletedCheck = await Desconto.findByPk(pctDiscountId);
    assert(deletedCheck.deletado === 'S', "Soft delete flag should be set to 'S'");

    // Restore it back to active for further application testing
    deletedCheck.deletado = 'N';
    deletedCheck.ativo = true;
    await deletedCheck.save();

    // ==========================================
    // 2. DISPONIBILIDADE E AUTORIZAÇÃO
    // ==========================================
    console.log("\n--- SCENARIO 2: DISPONIBILIDADE E AUTORIZAÇÃO ---");
    
    // Test inactive discount visibility simulation: UI filters `d.ativo === true` and `d.deletado === 'N'`.
    // In backend, check listDescontos returns only non-deleted.
    // Create an inactive discount to verify visibility:
    req = {
      body: {
        codigo: "TEST_INACTIVE",
        descricao: "Inactive Discount",
        tipo: "porcentagem",
        valor: 15,
        ativo: false,
        incide_comissao: true
      }
    };
    res = makeMockRes();
    await createDesconto(req, res);
    const inactiveId = res.jsonData.id;
    createdDiscountIds.push(inactiveId);

    // Apply inactive discount check
    req = {
      params: { id: uuidv4() }, // dummy venda ID
      body: { descontoId: inactiveId }
    };
    res = makeMockRes();
    // Create a mock venda to test application of inactive discount
    const testVenda = await VendaDireta.create({
      id: uuidv4(),
      produto_id: prodA.id,
      produto_nome: prodA.nome,
      quantidade: 1,
      valor_total: 100,
      itens: [{ produto_id: prodA.id, produto_nome: prodA.nome, quantidade: 1, preco_unitario: 100, subtotal: 100 }],
      colaborador_id: colab.id,
      status: 'pendente'
    });
    createdVendaIds.push(testVenda.id);

    req.params.id = testVenda.id;
    await aplicarDescontoVenda(req, res);
    assert(res.statusCode === 444, "Applying inactive discount should fail with 444");

    // Authorization checks for restricted discounts
    const authDiscount = await Desconto.create({
      id: uuidv4(),
      codigo: "TEST_RESTRICTED",
      tipo: "porcentagem",
      valor: 20,
      ativo: true,
      requer_autorizacao: true,
      usuarios_autorizados: JSON.stringify([normalUser.id])
    });
    createdDiscountIds.push(authDiscount.id);

    // Test with invalid credentials
    req = {
      body: {
        id: authDiscount.id,
        email: "test_user@salon.com",
        password: "wrong_password"
      }
    };
    res = makeMockRes();
    await validarDescontoAutorizacao(req, res);
    assert(res.statusCode === 401, "Valid credentials should fail on incorrect password");

    // Test with non-authorized user credentials
    const otherUser = await User.create({
      id: uuidv4(),
      email: "test_other@salon.com",
      password_hash: testPasswordHash,
      name: "Other User",
      role: "funcionario",
      ativo: true
    });
    createdUserIds.push(otherUser.id);

    req.body.email = "test_other@salon.com";
    req.body.password = "admin123";
    res = makeMockRes();
    await validarDescontoAutorizacao(req, res);
    assert(res.statusCode === 403, "Credentials should fail if user is not in the authorized list and is not admin");

    // Test with authorized user credentials
    req.body.email = "test_user@salon.com";
    req.body.password = "admin123";
    res = makeMockRes();
    await validarDescontoAutorizacao(req, res);
    assert(res.statusCode === 200 && res.jsonData.success === true, "Authorized user credentials should succeed");

    // Test with non-listed admin credentials (admins are always authorized)
    req.body.email = "test_admin@salon.com";
    req.body.password = "admin123";
    res = makeMockRes();
    await validarDescontoAutorizacao(req, res);
    assert(res.statusCode === 200 && res.jsonData.success === true, "Admin credentials should always succeed even if not explicitly listed");

    // ==========================================
    // 3. APLICAÇÃO DE DESCONTOS & VINCULAÇÃO
    // ==========================================
    console.log("\n--- SCENARIO 3: APLICAÇÃO DE DESCONTOS & VINCULAÇÃO ---");

    // 3.1 Proportional distribution and item linkage
    // Create a discount linked ONLY to Product A
    const linkedDiscount = await Desconto.create({
      id: uuidv4(),
      codigo: "TEST_LINKED_PROD_A",
      tipo: "porcentagem",
      valor: 10,
      ativo: true,
      itens_vinculados: JSON.stringify({ services: [], products: [prodA.id] })
    });
    createdDiscountIds.push(linkedDiscount.id);

    // Venda containing Product A (eligible) and Product B (not eligible)
    const complexVenda = await VendaDireta.create({
      id: uuidv4(),
      produto_id: prodA.id,
      produto_nome: prodA.nome,
      quantidade: 3,
      valor_total: 200,
      itens: [
        { produto_id: prodA.id, produto_nome: prodA.nome, quantidade: 1, preco_unitario: 100, subtotal: 100 },
        { produto_id: prodB.id, produto_nome: prodB.nome, quantidade: 2, preco_unitario: 50, subtotal: 100 }
      ],
      colaborador_id: colab.id,
      status: 'pendente'
    });
    createdVendaIds.push(complexVenda.id);

    // Apply the linked discount
    req = {
      params: { id: complexVenda.id },
      body: { descontoId: linkedDiscount.id }
    };
    res = makeMockRes();
    await aplicarDescontoVenda(req, res);
    assert(res.statusCode === 200, "Applying linked discount should succeed");
    
    // Check calculations:
    // Only Product A is eligible: Subtotal A = 100. Product B = 100 (ineligible).
    // Discount on A = 10% of 100 = 10.
    // Final Subtotal A = 90. Final Subtotal B = 100.
    // Total Venda = 190.
    let updatedVenda = await VendaDireta.findByPk(complexVenda.id);
    let items = updatedVenda.itens;
    let itemA = items.find(i => i.produto_id === prodA.id);
    let itemB = items.find(i => i.produto_id === prodB.id);
    
    assert(itemA.subtotal === 90, "Product A subtotal should be reduced by 10% (100 -> 90)");
    assert(itemB.subtotal === 100, "Product B subtotal should remain 100");
    assert(updatedVenda.valor_total === 190, "Total value of Venda should be 190");
    assert(updatedVenda.desconto_aplicado.total_descontado === 10, "Metadata total discounted should record 10");
    assert(updatedVenda.desconto_aplicado.codigo === "TEST_LINKED_PROD_A", "Metadata should record discount code applied");

    // 3.2 Single discount per item restriction
    // Try to apply another discount on top. Because the controller re-maps and restores original prices first, 
    // it prevents double discounting and replaces the existing discount.
    // Let's verify this swap behavior.
    
    // ==========================================
    // 4. SUBSTITUIÇÃO E REMOÇÃO (SWAP & REMOVE)
    // ==========================================
    console.log("\n--- SCENARIO 4: SUBSTITUIÇÃO E REMOÇÃO ---");
    
    // Swap with TEST_FIX_20 (fixed R$20 discount, which applies to all products because it has no linkages)
    req = {
      params: { id: complexVenda.id },
      body: { descontoId: fixDiscountId }
    };
    res = makeMockRes();
    await aplicarDescontoVenda(req, res);
    assert(res.statusCode === 200, "Swapping discount should succeed");
    
    // Verify that the original prices were restored first, then the fixed 20 discount was distributed proportionally.
    // Total eligible subtotal = 100 (A) + 100 (B) = 200.
    // Proportional division of 20: 
    // Proporcao A = 100/200 = 0.5. Discount A = 10. Final Subtotal A = 90.
    // Proporcao B = 100/200 = 0.5. Discount B = 10. Final Subtotal B = 90.
    // Total Venda = 180.
    updatedVenda = await VendaDireta.findByPk(complexVenda.id);
    itemA = updatedVenda.itens.find(i => i.produto_id === prodA.id);
    itemB = updatedVenda.itens.find(i => i.produto_id === prodB.id);
    
    assert(itemA.subtotal === 90, "Product A subtotal should be 90 under R$ 20 proportional discount");
    assert(itemB.subtotal === 90, "Product B subtotal should be 90 under R$ 20 proportional discount");
    assert(updatedVenda.valor_total === 180, "Total value of Venda should be 180");
    assert(updatedVenda.desconto_aplicado.total_descontado === 20, "Metadata should reflect the new total discounted of 20");
    assert(updatedVenda.desconto_aplicado.codigo === "TEST_FIX_20", "Metadata should reflect the new applied discount");

    // Remove the discount entirely
    req = {
      params: { id: complexVenda.id },
      body: { descontoId: null } // null clears discount
    };
    res = makeMockRes();
    await aplicarDescontoVenda(req, res);
    assert(res.statusCode === 200, "Removing discount should succeed");
    
    // Verify original prices and totals are restored
    updatedVenda = await VendaDireta.findByPk(complexVenda.id);
    itemA = updatedVenda.itens.find(i => i.produto_id === prodA.id);
    itemB = updatedVenda.itens.find(i => i.produto_id === prodB.id);
    
    assert(itemA.subtotal === 100, "Product A should return to original subtotal 100");
    assert(itemB.subtotal === 100, "Product B should return to original subtotal 100");
    assert(updatedVenda.valor_total === 200, "Total Venda should return to original 200");
    assert(updatedVenda.desconto_aplicado === null, "desconto_aplicado metadata should be cleared");

    // ==========================================
    // 5. PAGAMENTO E BLOQUEIO (LOCKS)
    // ==========================================
    console.log("\n--- SCENARIO 5: PAGAMENTO E BLOQUEIO ---");
    
    // Apply discount again
    req = {
      params: { id: complexVenda.id },
      body: { descontoId: fixDiscountId }
    };
    res = makeMockRes();
    await aplicarDescontoVenda(req, res);
    
    // Add a partial payment
    req = {
      params: { id: complexVenda.id },
      body: {
        pagamentos: [
          { valor: 50, forma_pagamento: "dinheiro", observacao: "Partial payment" }
        ],
        finalizar: false
      }
    };
    res = makeMockRes();
    await addVendaPagamentos(req, res);
    assert(res.statusCode === 200, "Registering partial payment should succeed");
    
    // Now try to apply/change discount: should be BLOCKED
    req = {
      params: { id: complexVenda.id },
      body: { descontoId: pctDiscountId }
    };
    res = makeMockRes();
    await aplicarDescontoVenda(req, res);
    assert(res.statusCode === 400, "Modifying discount after payment should fail with 400");
    
    // Try to remove discount: should be BLOCKED
    req.body.descontoId = null;
    res = makeMockRes();
    await aplicarDescontoVenda(req, res);
    assert(res.statusCode === 400, "Removing discount after payment should fail with 400");

    // ==========================================
    // 6. IMPACTO EM COMISSÃO (INCIDE SOBRE COMISSÃO)
    // ==========================================
    console.log("\n--- SCENARIO 6: IMPACTO EM COMISSÃO ---");
    
    // Scenario 6.1: Discount Affects Commission (incide_comissao = true)
    // Setup appointment
    const appointmentA = await Agendamento.create({
      id: uuidv4(),
      cliente_id: cliente.id,
      cliente_nome: cliente.nome,
      data_hora: "2026-06-01T10:00:00.000Z",
      itens: [
        { servico_id: servA.id, nome: servA.nome, valor: 100, colaborador_id: colab.id }
      ],
      valor_total: 100,
      status: 'agendado'
    });
    createdAgendamentoIds.push(appointmentA.id);

    // Apply pctDiscountId (TEST_PCT_10_UPDATED which is 10% off and incide_comissao = true)
    req = {
      params: { aid: appointmentA.id },
      body: { descontoId: pctDiscountId }
    };
    res = makeMockRes();
    await aplicarDescontoAgendamento(req, res);
    assert(res.statusCode === 200, "Applying discount to appointment should succeed");
    
    // Final value should be 90
    let updatedAg = await Agendamento.findByPk(appointmentA.id);
    assert(updatedAg.valor_total === 90, "Appointment total should be 90");
    
    // Add full payment and finalize to make status 'concluido'
    req = {
      params: { aid: appointmentA.id },
      body: {
        pagamentos: [{ valor: 90, forma_pagamento: "pix" }],
        finalizar: true
      }
    };
    res = makeMockRes();
    await addAgendamentoPagamentos(req, res);
    assert(res.statusCode === 200, "Paying and finalizing appointment should succeed");
    
    // Fetch commissions for 2026-06
    req = {
      query: {
        data_inicio: "2026-06-01",
        data_fim: "2026-06-30",
        colaborador_id: colab.id
      }
    };
    res = makeMockRes();
    await listComissoes(req, res);
    assert(res.statusCode === 200, "Fetching commissions should succeed");
    
    // Commission should be based on 90 (value after discount).
    // Commission = 90 * 10% = 9.00
    let colabCom = res.jsonData.comissoes.find(c => c.colaborador_id === colab.id);
    let servDetail = colabCom.detalhes.find(d => d.descricao === servA.nome);
    assert(servDetail.valor_comissao === 9.00, `Commission should be 9.00 (got ${servDetail.valor_comissao})`);

    // Scenario 6.2: Discount Does NOT Affect Commission (incide_comissao = false)
    // Setup another appointment
    const appointmentB = await Agendamento.create({
      id: uuidv4(),
      cliente_id: cliente.id,
      cliente_nome: cliente.nome,
      data_hora: "2026-06-02T10:00:00.000Z",
      itens: [
        { servico_id: servA.id, nome: servA.nome, valor: 100, colaborador_id: colab.id }
      ],
      valor_total: 100,
      status: 'agendado'
    });
    createdAgendamentoIds.push(appointmentB.id);

    // Apply fixDiscountId (TEST_FIX_20 which has incide_comissao = false)
    req = {
      params: { aid: appointmentB.id },
      body: { descontoId: fixDiscountId }
    };
    res = makeMockRes();
    await aplicarDescontoAgendamento(req, res);
    assert(res.statusCode === 200, "Applying fixed discount should succeed");
    
    // Final value should be 80
    updatedAg = await Agendamento.findByPk(appointmentB.id);
    assert(updatedAg.valor_total === 80, "Appointment total should be 80");

    // Add full payment and finalize
    req = {
      params: { aid: appointmentB.id },
      body: {
        pagamentos: [{ valor: 80, forma_pagamento: "pix" }],
        finalizar: true
      }
    };
    res = makeMockRes();
    await addAgendamentoPagamentos(req, res);
    assert(res.statusCode === 200, "Paying and finalizing appointment B should succeed");

    // Fetch commissions again
    req = {
      query: {
        data_inicio: "2026-06-01",
        data_fim: "2026-06-30",
        colaborador_id: colab.id
      }
    };
    res = makeMockRes();
    await listComissoes(req, res);
    
    // For appointment B, commission base should be the original price 100.
    // Commission = 100 * 10% = 10.00
    colabCom = res.jsonData.comissoes.find(c => c.colaborador_id === colab.id);
    // Find detail for B: let's filter by matching the valor_movimentacao = 80
    let servDetailB = colabCom.detalhes.find(d => d.valor_movimentacao === 80);
    assert(servDetailB.valor_comissao === 10.00, `Commission should be 10.00 (got ${servDetailB.valor_comissao})`);

    console.log("\n=== ALL AUTOMATED VALIDATION SCENARIOS COMPLETED SUCCESSFULLY ===");
  } catch (error) {
    console.error("\n\x1b[31m=== VALIDATION RUN TERMINATED WITH ERRORS ===\x1b[0m");
    console.error(error);
  } finally {
    // 7. CLEAN UP TEST DATA
    console.log("\n--- CLEANING UP TEST DATA ---");
    
    // Delete payments first
    if (createdVendaIds.length > 0) {
      await Pagamento.destroy({ where: { venda_direta_id: createdVendaIds } });
    }
    if (createdAgendamentoIds.length > 0) {
      await Pagamento.destroy({ where: { agendamento_id: createdAgendamentoIds } });
    }
    
    // Delete main entities
    if (createdUserIds.length > 0) {
      await User.destroy({ where: { id: createdUserIds } });
    }
    if (createdDiscountIds.length > 0) {
      await Desconto.destroy({ where: { id: createdDiscountIds } });
    }
    if (createdVendaIds.length > 0) {
      await VendaDireta.destroy({ where: { id: createdVendaIds } });
    }
    if (createdAgendamentoIds.length > 0) {
      await Agendamento.destroy({ where: { id: createdAgendamentoIds } });
    }
    if (createdProductIds.length > 0) {
      await Produto.destroy({ where: { id: createdProductIds } });
    }
    if (createdServiceIds.length > 0) {
      await Servico.destroy({ where: { id: createdServiceIds } });
    }
    if (createdColabIds.length > 0) {
      await Colaborador.destroy({ where: { id: createdColabIds } });
    }
    if (createdClienteIds.length > 0) {
      await Cliente.destroy({ where: { id: createdClienteIds } });
    }
    console.log("Cleanup completed successfully.");
  }
}

tenantStorage.run("company_salon", () => {
  run();
});

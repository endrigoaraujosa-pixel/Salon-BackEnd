import http from 'http';

function req(options, body = null) {
  return new Promise((resolve, reject) => {
    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function runTests() {
  console.log('=== INICIANDO TESTES DE INTEGRAÇÃO DO CARRINHO ===\n');

  // 1. Login Administrativo
  console.log('[1] Realizando login...');
  const loginRes = await req(
    { hostname: 'localhost', port: 5000, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } },
    { email: 'admin@salon.com', password: 'admin' }
  );
  if (loginRes.status !== 200) {
    throw new Error('Falha no login inicial: ' + JSON.stringify(loginRes.body));
  }
  const token = loginRes.body.token;
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  console.log('✔ Login efetuado com sucesso!\n');

  // 2. Coletar dados auxiliares (Produtos e Colaboradores)
  console.log('[2] Buscando colaboradores e produtos para os testes...');
  const colabsRes = await req({ hostname: 'localhost', port: 5000, path: '/api/colaboradores', method: 'GET', headers });
  const colabId = colabsRes.body?.[0]?.id;
  if (!colabId) throw new Error('Nenhum colaborador encontrado no sistema.');

  const prodsRes = await req({ hostname: 'localhost', port: 5000, path: '/api/produtos', method: 'GET', headers });
  const todosProds = prodsRes.body || [];
  const prodA = todosProds.find(p => p.quantidade_estoque > 5);
  const prodB = todosProds.find(p => p.quantidade_estoque > 5 && p.id !== prodA?.id);

  if (!prodA || !prodB) {
    throw new Error('Certifique-se de que existem pelo menos 2 produtos cadastrados com estoque > 5.');
  }
  console.log(`✔ Utilizando Colaborador: ${colabsRes.body[0].nome}`);
  console.log(`✔ Produto A: ${prodA.nome} (Estoque: ${prodA.quantidade_estoque}, Preço: R$ ${prodA.preco_venda})`);
  console.log(`✔ Produto B: ${prodB.nome} (Estoque: ${prodB.quantidade_estoque}, Preço: R$ ${prodB.preco_venda})\n`);

  // 3. Criar Venda sem Pagamento
  console.log('[3] Criando venda sem pagamento (status pendente)...');
  const createRes = await req(
    { hostname: 'localhost', port: 5000, path: '/api/vendas-diretas', method: 'POST', headers },
    {
      itens: [{ produto_id: prodA.id, quantidade: 2, preco_unitario: prodA.preco_venda }],
      colaborador_id: colabId
    }
  );
  if (createRes.status !== 201) {
    throw new Error('Falha ao criar venda: ' + JSON.stringify(createRes.body));
  }
  const vendaId = createRes.body.id;
  console.log(`✔ Venda criada! ID: ${vendaId}, Total: R$ ${createRes.body.valor_total}`);
  
  // 4. Visualizar Carrinho inicial
  console.log('\n[4] Visualizando o carrinho recém-criado...');
  const cartRes = await req({ hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}/carrinho`, method: 'GET', headers });
  if (cartRes.status !== 200) {
    throw new Error('Erro ao buscar carrinho.');
  }
  console.log(`✔ Carrinho retornado! Bloqueado: ${cartRes.body.bloqueado}`);
  console.log(`  Itens no carrinho: ${cartRes.body.itens.length}`);
  cartRes.body.itens.forEach((it, idx) => console.log(`  - [${idx}] ${it.produto_nome}: Qtd ${it.quantidade}, Subtotal: R$ ${it.subtotal}`));

  // 5. Adicionar Produto B ao Carrinho
  console.log('\n[5] Adicionando Produto B ao carrinho...');
  const addRes = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}/carrinho/itens`, method: 'POST', headers },
    { produto_id: prodB.id, quantidade: 3, preco_unitario: prodB.preco_venda }
  );
  if (addRes.status !== 201) {
    throw new Error('Erro ao adicionar produto ao carrinho: ' + JSON.stringify(addRes.body));
  }
  console.log(`✔ Produto B adicionado! Novo Total da Venda: R$ ${addRes.body.valor_total}`);

  // 6. Alterar quantidade do item 0 (Produto A)
  console.log('\n[6] Alterando quantidade do Produto A (índice 0) para 4 unidades...');
  const updateRes = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}/carrinho/itens/0`, method: 'PUT', headers },
    { quantidade: 4 }
  );
  if (updateRes.status !== 200) {
    throw new Error('Erro ao alterar quantidade do item: ' + JSON.stringify(updateRes.body));
  }
  console.log(`✔ Quantidade alterada! Novo Total da Venda: R$ ${updateRes.body.valor_total}`);

  // 7. Vincular Pagamento e Finalizar Venda
  console.log(`\n[7] Adicionando pagamento no valor total de R$ ${updateRes.body.valor_total} (vinculando pagamento)...`);
  const payRes = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}/pagamentos`, method: 'POST', headers },
    {
      pagamentos: [{ valor: updateRes.body.valor_total, forma_pagamento: 'pix', observacao: 'Teste integração' }],
      finalizar: true
    }
  );
  if (payRes.status !== 200) {
    throw new Error('Erro ao registrar pagamento: ' + JSON.stringify(payRes.body));
  }
  console.log('✔ Pagamento registrado com sucesso! Venda quitada.');

  // 8. Tentar alterar o carrinho da venda com pagamento vinculado
  console.log('\n[8] Testando BLOQUEIO: Tentando adicionar um produto com pagamento vinculado...');
  const blockAddRes = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}/carrinho/itens`, method: 'POST', headers },
    { produto_id: prodA.id, quantidade: 1, preco_unitario: prodA.preco_venda }
  );
  console.log(`  → Retorno da API: Status ${blockAddRes.status}`);
  console.log(`  → Detalhe do Erro: "${blockAddRes.body?.detail}"`);
  if (blockAddRes.status !== 403 || blockAddRes.body?.detail !== 'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.') {
    throw new Error('O BLOQUEIO DE ADIÇÃO DE ITEM FALHOU ou retornou a mensagem de erro incorreta.');
  }
  console.log('✔ Bloqueio de ADIÇÃO funcionando perfeitamente!');

  console.log('\n[9] Testando BLOQUEIO: Tentando alterar quantidade de item com pagamento vinculado...');
  const blockUpdateRes = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}/carrinho/itens/0`, method: 'PUT', headers },
    { quantidade: 5 }
  );
  console.log(`  → Retorno da API: Status ${blockUpdateRes.status}`);
  console.log(`  → Detalhe do Erro: "${blockUpdateRes.body?.detail}"`);
  if (blockUpdateRes.status !== 403 || blockUpdateRes.body?.detail !== 'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.') {
    throw new Error('O BLOQUEIO DE ALTERAÇÃO DE QUANTIDADE FALHOU ou retornou a mensagem de erro incorreta.');
  }
  console.log('✔ Bloqueio de ALTERAÇÃO DE QUANTIDADE funcionando perfeitamente!');

  console.log('\n[10] Testando BLOQUEIO: Tentando remover item com pagamento vinculado...');
  const blockDelRes = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}/carrinho/itens/0`, method: 'DELETE', headers },
  );
  console.log(`  → Retorno da API: Status ${blockDelRes.status}`);
  console.log(`  → Detalhe do Erro: "${blockDelRes.body?.detail}"`);
  if (blockDelRes.status !== 403 || blockDelRes.body?.detail !== 'Não é permitido alterar o carrinho de uma venda que já possui pagamento vinculado.') {
    throw new Error('O BLOQUEIO DE REMOÇÃO DE ITEM FALHOU ou retornou a mensagem de erro incorreta.');
  }
  console.log('✔ Bloqueio de REMOÇÃO DE ITEM funcionando perfeitamente!');

  // 11. Remover Pagamento (Estorno) para validar rebloqueio/desbloqueio
  console.log('\n[11] Estornando pagamento para desbloquear o carrinho novamente...');
  const vendaDataRes = await req({ hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}`, method: 'GET', headers });
  const pagamentoId = vendaDataRes.body?.pagamentos?.[0]?.id;
  if (!pagamentoId) throw new Error('Não foi possível recuperar o ID do pagamento registrado.');

  const delPayRes = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}/pagamentos/${pagamentoId}?email=admin@salon.com&password=admin`, method: 'DELETE', headers }
  );
  if (delPayRes.status !== 200) {
    throw new Error('Erro ao estornar pagamento: ' + JSON.stringify(delPayRes.body));
  }
  console.log('✔ Pagamento estornado com sucesso!');

  // 12. Validar que o carrinho voltou a estar liberado
  console.log('\n[12] Verificando se o carrinho foi desbloqueado com sucesso após estorno...');
  const unlockRes = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}/carrinho/itens/1`, method: 'DELETE', headers }
  );
  if (unlockRes.status !== 200) {
    throw new Error('Carrinho deveria estar desbloqueado após estorno total do pagamento.');
  }
  console.log(`✔ Item removido com sucesso! Novo total da venda: R$ ${unlockRes.body.valor_total}`);
  console.log(`✔ Quantidade de itens restante no carrinho: ${unlockRes.body.itens.length}`);

  // 13. Testar novo bloqueio de exclusão de venda com pagamento
  console.log('\n[13] Testando BLOQUEIO DE EXCLUSÃO: Adicionando um pagamento novamente...');
  const pay2Res = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}/pagamentos`, method: 'POST', headers },
    {
      pagamentos: [{ valor: unlockRes.body.valor_total, forma_pagamento: 'pix', observacao: 'Teste exclusão' }],
      finalizar: true
    }
  );
  if (pay2Res.status !== 200) {
    throw new Error('Erro ao adicionar pagamento secundário.');
  }
  
  console.log('  → Tentando excluir a venda que agora tem pagamentos...');
  const blockDelSaleRes = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${vendaId}`, method: 'DELETE', headers }
  );
  console.log(`  → Retorno da API: Status ${blockDelSaleRes.status}`);
  console.log(`  → Detalhe do Erro: "${blockDelSaleRes.body?.detail}"`);
  if (blockDelSaleRes.status !== 400 || blockDelSaleRes.body?.detail !== 'Não é permitido excluir uma venda que possui pagamentos registrados.') {
    throw new Error('O BLOQUEIO DE EXCLUSÃO DE VENDA COM PAGAMENTOS FALHOU ou retornou a mensagem incorreta.');
  }
  console.log('✔ Bloqueio de exclusão de venda com pagamentos funcionando perfeitamente!');

  // 14. Testar exclusão de venda sem pagamento
  console.log('\n[14] Testando EXCLUSÃO DE VENDA SEM PAGAMENTO...');
  console.log('  → Criando uma nova venda limpa...');
  const cleanVendaRes = await req(
    { hostname: 'localhost', port: 5000, path: '/api/vendas-diretas', method: 'POST', headers },
    {
      itens: [{ produto_id: prodA.id, quantidade: 1, preco_unitario: prodA.preco_venda }],
      colaborador_id: colabId
    }
  );
  const cleanVendaId = cleanVendaRes.body.id;
  
  console.log('  → Excluindo a venda sem pagamentos...');
  const deleteCleanRes = await req(
    { hostname: 'localhost', port: 5000, path: `/api/vendas-diretas/${cleanVendaId}`, method: 'DELETE', headers }
  );
  console.log(`  → Retorno da API: Status ${deleteCleanRes.status}`);
  if (deleteCleanRes.status !== 200 || !deleteCleanRes.body?.ok) {
    throw new Error('A EXCLUSÃO DE VENDA SEM PAGAMENTOS FALHOU.');
  }
  console.log('✔ Exclusão de venda sem pagamentos concluída e validada!');

  console.log('\n==================================================');
  console.log('🎉 TODOS OS TESTES PASSARAM COM SUCESSO! 🎉');
  console.log('==================================================');
}

runTests().catch(e => {
  console.error('\n❌ ERRO DURANTE OS TESTES DE INTEGRAÇÃO:\n', e.message);
  process.exit(1);
});

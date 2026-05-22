import http from 'http';

function req(options, body = null) {
  return new Promise((resolve, reject) => {
    const r = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function run() {
  // 1. Login
  const login = await req({ hostname:'localhost', port:5000, path:'/api/auth/login', method:'POST', headers:{'Content-Type':'application/json'} }, { email:'admin@salon.com', password:'admin' });
  const token = login.body?.token;

  // 2. Buscar produtos direto (para pegar ID real)
  const prods = await req({ hostname:'localhost', port:5000, path:'/api/produtos', method:'GET', headers:{'Authorization':`Bearer ${token}`} });
  const todosProds = prods.body;
  console.log('Total produtos:', todosProds?.length);
  todosProds?.slice(0,3).forEach(p => console.log('  →', p.id, p.nome, 'estoque:', p.quantidade_estoque));

  // 3. Buscar colaboradores
  const colabs = await req({ hostname:'localhost', port:5000, path:'/api/colaboradores', method:'GET', headers:{'Authorization':`Bearer ${token}`} });
  const colaborador_id = colabs.body?.[0]?.id;

  // 4. Testar com 2 produtos diferentes
  const prodA = todosProds?.find(p => p.quantidade_estoque > 0);
  const prodB = todosProds?.find(p => p.quantidade_estoque > 0 && p.id !== prodA?.id);

  const payload = {
    itens: [
      { produto_id: prodA.id, quantidade: 1, preco_unitario: prodA.preco_venda },
      ...(prodB ? [{ produto_id: prodB.id, quantidade: 1, preco_unitario: prodB.preco_venda }] : [])
    ],
    colaborador_id
  };
  console.log('\nPayload itens:');
  payload.itens.forEach(i => console.log(' -', i.produto_id, 'qtd:', i.quantidade));

  const venda = await req(
    { hostname:'localhost', port:5000, path:'/api/vendas-diretas', method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`} },
    payload
  );
  console.log('\nResposta:', venda.status);
  console.log(JSON.stringify(venda.body, null, 2));
}

run().catch(e => console.error('ERRO:', e.message));

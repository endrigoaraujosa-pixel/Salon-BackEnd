import http from 'http';

function postJSON(path, data, token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    };
    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(chunks) });
        } catch {
          resolve({ status: res.statusCode, data: chunks });
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getJSON(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method: 'GET',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    };
    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(chunks) });
        } catch {
          resolve({ status: res.statusCode, data: chunks });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  try {
    // 1. Login
    console.log('=== 1. Login ===');
    const login = await postJSON('/api/auth/login', { email: 'admin@salon.com', password: 'admin123' });
    console.log('Status:', login.status);
    if (login.status !== 200) {
      // Try alternate credentials
      const login2 = await postJSON('/api/auth/login', { email: 'admin@admin.com', password: 'admin' });
      console.log('Alt login status:', login2.status);
      if (login2.status !== 200) {
        console.log('Login failed with both credentials');
        console.log('Response:', JSON.stringify(login.data));
        console.log('Alt Response:', JSON.stringify(login2.data));
        process.exit(1);
      }
      login.data = login2.data;
    }
    const token = login.data.token;
    console.log('Token obtido:', token ? 'SIM' : 'NÃO');

    // 2. Listar serviços deletados
    console.log('\n=== 2. Listar serviços deletados ===');
    const deletados = await getJSON('/api/auditoria/deletados?modulo=servico', token);
    console.log('Status:', deletados.status);
    console.log('Total:', Array.isArray(deletados.data) ? deletados.data.length : 'N/A');
    if (Array.isArray(deletados.data) && deletados.data.length > 0) {
      console.log('Primeiro:', JSON.stringify(deletados.data[0]));
    }

    // 3. Tentar restaurar primeiro serviço deletado
    if (Array.isArray(deletados.data) && deletados.data.length > 0) {
      const toRestore = deletados.data[0];
      console.log('\n=== 3. Restaurar serviço ===');
      console.log('ID:', toRestore.id);
      console.log('Descrição:', toRestore.descricao);
      
      const result = await postJSON('/api/auditoria/restaurar', {
        modulo: 'servico',
        id: toRestore.id
      }, token);
      
      console.log('Status:', result.status);
      console.log('Response:', JSON.stringify(result.data));
      
      if (result.status === 200) {
        console.log('\n✅ RESTAURAÇÃO VIA API BEM SUCEDIDA');
        
        // 4. Re-deletar para não poluir
        console.log('\n=== 4. Re-deletando (rollback) ===');
        // We don't have a direct re-delete via API, so just note it
        console.log('Registro restaurado. Será necessário re-deletar manualmente se desejado.');
      } else {
        console.log('\n❌ ERRO NA RESTAURAÇÃO VIA API');
      }
    } else {
      console.log('\nNenhum serviço deletado para testar restauração.');
    }
  } catch (e) {
    console.error('ERRO:', e.message);
  }
  process.exit(0);
}

run();

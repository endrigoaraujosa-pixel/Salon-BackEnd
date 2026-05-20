import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { connectDB, sequelize } from './config/db.js';
import User from './models/User.js';
import Agendamento from './models/Agendamento.js';
import VendaDireta from './models/VendaDireta.js';
import PagamentoComissao from './models/PagamentoComissao.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import OutrasReceitas from './models/OutrasReceitas.js';

import { login, logout, me } from './controllers/authController.js';
import { protect, admin } from './middleware/auth.js';
import { listClientes, createCliente, updateCliente, deleteCliente, historicoCliente } from './controllers/clienteController.js';
import { listColab, createColab, updateColab, deleteColab } from './controllers/colaboradorController.js';
import { listServ, createServ, updateServ, deleteServ } from './controllers/servicoController.js';
import { listProd, createProd, updateProd, deleteProd } from './controllers/produtoController.js';
import { listAgend, getAgend, createAgend, updateAgend, deleteAgend, setStatus, addPagamentos, updatePagamento as updateAgendamentoPagamento, deletePagamento as deleteAgendamentoPagamento } from './controllers/agendamentoController.js';
import { dashboard, relatorioDre, relatorioCaixa, relatorioProdutos, relatorioServicos } from './controllers/reportController.js';
import { listDespesas, createDespesa, updateDespesa, deleteDespesa } from './controllers/despesaController.js';
import { getTaxas, saveTaxa } from './controllers/configuracaoController.js';
import { listUsers, createUser, updateUser, deleteUser } from './controllers/userController.js';
import { listVendas, getVenda, createVenda, deleteVenda, addPagamentos as addVendaPagamentos, updatePagamento as updateVendaPagamento, deletePagamento as deleteVendaPagamento } from './controllers/vendaDiretaController.js';
import { listComissoes, pagarComissao, desfazerPagamento } from './controllers/comissaoController.js';
import { listReceitas, createReceita, updateReceita, deleteReceita } from './controllers/outrasReceitasController.js';

const app = express();

// Middleware
app.use(cors({
  origin: true, // Permite qualquer origem dinâmica para facilitar testes locais e em celulares
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Routes
const authRoutes = express.Router();
authRoutes.post('/login', login);
authRoutes.post('/logout', logout);
authRoutes.get('/me', protect, me);
app.use('/api/auth', authRoutes);

// Clientes Routes
const clienteRoutes = express.Router();
clienteRoutes.get('/', protect, listClientes);
clienteRoutes.post('/', protect, createCliente);
clienteRoutes.put('/:cid', protect, updateCliente);
clienteRoutes.delete('/:cid', protect, deleteCliente);
clienteRoutes.get('/:cid/historico', protect, historicoCliente);
app.use('/api/clientes', clienteRoutes);

// Colaboradores Routes
const colabRoutes = express.Router();
colabRoutes.get('/', protect, listColab);
colabRoutes.post('/', protect, createColab);
colabRoutes.put('/:cid', protect, updateColab);
colabRoutes.delete('/:cid', protect, deleteColab);
app.use('/api/colaboradores', colabRoutes);

// Servicos Routes
const servRoutes = express.Router();
servRoutes.get('/', protect, listServ);
servRoutes.post('/', protect, createServ);
servRoutes.put('/:sid', protect, updateServ);
servRoutes.delete('/:sid', protect, deleteServ);
app.use('/api/servicos', servRoutes);

// Produtos Routes
const prodRoutes = express.Router();
prodRoutes.get('/', protect, listProd);
prodRoutes.post('/', protect, createProd);
prodRoutes.put('/:pid', protect, updateProd);
prodRoutes.delete('/:pid', protect, deleteProd);
app.use('/api/produtos', prodRoutes);

// Agendamentos Routes
const agendRoutes = express.Router();
agendRoutes.get('/', protect, listAgend);
agendRoutes.get('/:aid', protect, getAgend);
agendRoutes.post('/', protect, createAgend);
agendRoutes.put('/:aid', protect, updateAgend);
agendRoutes.delete('/:aid', protect, deleteAgend);
agendRoutes.post('/:aid/status', protect, setStatus);
agendRoutes.post('/:aid/pagamentos', protect, addPagamentos);
agendRoutes.put('/:aid/pagamentos/:pid', protect, updateAgendamentoPagamento);
agendRoutes.delete('/:aid/pagamentos/:pid', protect, deleteAgendamentoPagamento);
app.use('/api/agendamentos', agendRoutes);

// Dashboard and Relatorios Routes
app.get('/api/dashboard', protect, dashboard);
app.get('/api/relatorios/dre', protect, admin, relatorioDre);
app.get('/api/relatorios/caixa', protect, admin, relatorioCaixa);
app.get('/api/relatorios/produtos', protect, admin, relatorioProdutos);
app.get('/api/relatorios/servicos', protect, admin, relatorioServicos);

// Users Routes
const userRoutes = express.Router();
userRoutes.get('/', protect, admin, listUsers);
userRoutes.post('/', protect, admin, createUser);
userRoutes.put('/:id', protect, admin, updateUser);
userRoutes.delete('/:id', protect, admin, deleteUser);
app.use('/api/users', userRoutes);

// Despesas Routes
const despesaRoutes = express.Router();
despesaRoutes.get('/', protect, admin, listDespesas);
despesaRoutes.post('/', protect, admin, createDespesa);
despesaRoutes.put('/:id', protect, admin, updateDespesa);
despesaRoutes.delete('/:id', protect, admin, deleteDespesa);
app.use('/api/despesas', despesaRoutes);

// Outras Receitas Routes
const outrasReceitasRoutes = express.Router();
outrasReceitasRoutes.get('/', protect, admin, listReceitas);
outrasReceitasRoutes.post('/', protect, admin, createReceita);
outrasReceitasRoutes.put('/:id', protect, admin, updateReceita);
outrasReceitasRoutes.delete('/:id', protect, admin, deleteReceita);
app.use('/api/outras-receitas', outrasReceitasRoutes);

// Vendas Diretas Routes
const vendaDiretaRoutes = express.Router();
vendaDiretaRoutes.get('/', protect, listVendas);
vendaDiretaRoutes.get('/:id', protect, getVenda);
vendaDiretaRoutes.post('/', protect, createVenda);
vendaDiretaRoutes.delete('/:id', protect, deleteVenda);
vendaDiretaRoutes.post('/:id/pagamentos', protect, addVendaPagamentos);
vendaDiretaRoutes.put('/:id/pagamentos/:pid', protect, updateVendaPagamento);
vendaDiretaRoutes.delete('/:id/pagamentos/:pid', protect, deleteVendaPagamento);
app.use('/api/vendas-diretas', vendaDiretaRoutes);

// Comissões Routes
const comissaoRoutes = express.Router();
comissaoRoutes.get('/', protect, admin, listComissoes);
comissaoRoutes.post('/pagar', protect, admin, pagarComissao);
comissaoRoutes.delete('/pagar', protect, admin, desfazerPagamento);
app.use('/api/comissoes', comissaoRoutes);

// Configuracoes Routes
const configRoutes = express.Router();
configRoutes.get('/taxas-cartao', protect, getTaxas);
configRoutes.post('/taxas-cartao', protect, saveTaxa);
app.use('/api/configuracoes', configRoutes);

// Seed Admin User
const seedAdmin = async () => {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@salon.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  const existing = await User.findOne({ where: { email: adminEmail } });
  if (!existing) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    await User.create({
      id: uuidv4(),
      email: adminEmail,
      password_hash: hashedPassword,
      name: 'Administrador',
      role: 'admin',
      ativo: true,
      pode_alterar_concluido: true,
      pode_excluir_agendamento: true,
      pode_excluir_pagamento: true
    });
    console.log('Admin user seeded');
  } else {
    // Garante que o administrador tenha as permissões ativas
    if (!existing.pode_alterar_concluido || !existing.pode_excluir_agendamento || !existing.pode_excluir_pagamento) {
      existing.pode_alterar_concluido = true;
      existing.pode_excluir_agendamento = true;
      existing.pode_excluir_pagamento = true;
      await existing.save();
      console.log('Admin permissions updated');
    }
    // Sync password if changed in env
    const isMatch = await bcrypt.compare(adminPassword, existing.password_hash);
    if (!isMatch) {
      const salt = await bcrypt.genSalt(10);
      existing.password_hash = await bcrypt.hash(adminPassword, salt);
      await existing.save();
      console.log('Admin password updated');
    }
  }
};

const migrateNumero = async () => {
  try {
    const ags = await Agendamento.findAll({ order: [['criado_em', 'ASC'], ['data_hora', 'ASC']] });
    let nextNum = 1;
    for (const ag of ags) {
      if (!ag.numero) {
        ag.numero = nextNum;
        await ag.save();
        console.log(`Assigned number #${nextNum} to appointment ${ag.id}`);
      }
      if (ag.numero >= nextNum) {
        nextNum = ag.numero + 1;
      }
    }
  } catch (error) {
    console.error('Error migrating appointment numbers:', error);
  }
};

const startServer = async () => {
  await connectDB();

  // Sync models
  await sequelize.sync();

  try {
    await sequelize.query("ALTER TABLE agendamentos ADD COLUMN numero INTEGER DEFAULT NULL;");
    console.log("Column 'numero' added to agendamentos table");
  } catch (err) {
    // Column already exists
  }

  try {
    await sequelize.query("ALTER TABLE users ADD COLUMN pode_excluir_pagamento BOOLEAN DEFAULT 0;");
    console.log("Column 'pode_excluir_pagamento' added to users table");
  } catch (err) {
    // Column already exists
  }

  try {
    await sequelize.query("ALTER TABLE users ADD COLUMN pode_excluir_agendamento BOOLEAN DEFAULT 0;");
    console.log("Column 'pode_excluir_agendamento' added to users table");
  } catch (err) {
    // Column already exists
  }

  try {
    const [info] = await sequelize.query("PRAGMA table_info(pagamentos);");
    const hasCol = info.some(col => col.name === 'venda_direta_id');
    if (!hasCol) {
      console.log("Migrating 'pagamentos' table to support direct sales...");
      await sequelize.query(`
        CREATE TABLE pagamentos_new (
          id VARCHAR(36) PRIMARY KEY,
          agendamento_id VARCHAR(36) NULL,
          venda_direta_id VARCHAR(36) NULL,
          valor FLOAT NOT NULL,
          forma_pagamento VARCHAR(50) NOT NULL,
          observacao TEXT DEFAULT '',
          data_hora DATETIME
        );
      `);
      await sequelize.query(`
        INSERT INTO pagamentos_new (id, agendamento_id, valor, forma_pagamento, observacao, data_hora)
        SELECT id, agendamento_id, valor, forma_pagamento, observacao, data_hora FROM pagamentos;
      `);
      await sequelize.query("DROP TABLE pagamentos;");
      await sequelize.query("ALTER TABLE pagamentos_new RENAME TO pagamentos;");
      console.log("Migration successful!");
    }
  } catch (error) {
    console.error("Migration failed:", error);
  }

  try {
    const [info] = await sequelize.query("PRAGMA table_info(pagamentos_comissao);");
    const hasPeriodo = info.some(col => col.name === 'periodo');
    if (!hasPeriodo) {
      console.log("Migrating 'pagamentos_comissao' table...");
      await sequelize.query("DROP TABLE IF EXISTS pagamentos_comissao;");
      await sequelize.query(`
        CREATE TABLE pagamentos_comissao (
          id VARCHAR(36) PRIMARY KEY,
          colaborador_id VARCHAR(36) NOT NULL,
          periodo VARCHAR(50) NOT NULL,
          valor FLOAT NOT NULL,
          data_pagamento DATETIME
        );
      `);
      console.log("Migration for 'pagamentos_comissao' successful!");
    }
  } catch (error) {
    console.error("Migration of comissao failed:", error);
  }

  try {
    await sequelize.query("ALTER TABLE vendas_diretas ADD COLUMN comissao_paga BOOLEAN DEFAULT 0;");
    console.log("Column 'comissao_paga' added to vendas_diretas table");
  } catch (err) {
    // Column already exists
  }

  try {
    await sequelize.query("ALTER TABLE servicos ADD COLUMN produtos_vinculados TEXT DEFAULT '[]';");
    console.log("Column 'produtos_vinculados' added to servicos table");
  } catch (err) {
    // Column already exists
  }

  await migrateNumero();

  await seedAdmin();

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();

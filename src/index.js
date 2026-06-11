import cookieParser from 'cookie-parser';
import cors from 'cors';
import 'dotenv/config';
import express from 'express';

import { addPagamentos, createAgend, deleteAgend, deletePagamento as deleteAgendamentoPagamento, getAgend, listAgend, setStatus, updateAgend, updatePagamento as updateAgendamentoPagamento, patchObservacoes, aplicarDescontoAgendamento } from './controllers/agendamentoController.js';
import { getDeletados, restoreRecord } from './controllers/auditController.js';
import { login, logout, me, refreshToken } from './controllers/authController.js';
import { createCategoria, deleteCategoria, listCategorias, updateCategoria } from './controllers/categoriaController.js';
import { createCliente, deleteCliente, historicoCliente, listClientes, updateCliente, rankingClientes } from './controllers/clienteController.js';
import { createColab, deleteColab, listColab, updateColab } from './controllers/colaboradorController.js';
import { desfazerPagamento, listComissoes, pagarComissao } from './controllers/comissaoController.js';
import { getTaxas, saveTaxa, getEmpresa, saveEmpresa } from './controllers/configuracaoController.js';
import { getWhatsappConfig, saveWhatsappConfig, getWhatsappHistory, postResendReminder, getLocalStatus, postLocalDisconnect } from './modules/whatsapp/whatsapp.controller.js';
import { initLocalClient } from './modules/whatsapp/local-client.js';
import { createDespesa, deleteDespesa, listDespesas, updateDespesa } from './controllers/despesaController.js';
import { createReceita, deleteReceita, listReceitas, updateReceita } from './controllers/outrasReceitasController.js';
import { createProd, deleteProd, listProd, updateProd } from './controllers/produtoController.js';
import { dashboard, dashboardDetail, relatorioCaixa, relatorioDre, relatorioProdutos, relatorioServicos, relatorioResultadoOperacional } from './controllers/reportController.js';
import { createServ, deleteServ, listServ, updateServ } from './controllers/servicoController.js';
import { createFornecedor, deleteFornecedor, listFornecedores, updateFornecedor } from './controllers/fornecedorController.js';
import { createUser, deleteUser, listUsers, updateUser } from './controllers/userController.js';
import { listarPerfis, obterPerfil, criarPerfil, atualizarPerfil, deletarPerfil } from './controllers/perfilAcessoController.js';
import { listEntradas, getEntradaDetail, registrarEntrada, registrarAjusteInventario, listMovimentacoes } from './controllers/estoqueController.js';
import { addItemCarrinho, addPagamentos as addVendaPagamentos, createVenda, deleteVenda, deletePagamento as deleteVendaPagamento, getCarrinho, getVenda, listVendas, removeItemCarrinho, updateItemCarrinho, updateCliente as updateVendaCliente, updatePagamento as updateVendaPagamento, aplicarDescontoVenda } from './controllers/vendaDiretaController.js';
import { listDescontos, createDesconto, updateDesconto, deleteDesconto, validarDescontoAutorizacao } from './controllers/descontoController.js';
import { admin, protect, requirePermission } from './middleware/auth.js';
import { connectDB } from './config/db.js';
import { startReminderJob } from './jobs/whatsapp-reminder.job.js';
import { tenantMiddleware } from './middleware/tenant.js';
import { convertLegacyStock } from '../scripts/convert-legacy-stock.js';

const app = express();

// Middleware
const allowedOrigins = [
  'https://salonstudio.com.br',
  'http://localhost:4000',
  'http://localhost:3000',
  'http://127.0.0.1:4000',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    console.log(origin);
    
    const isAllowed = allowedOrigins.includes(origin) ||
      /^(https:\/\/([a-zA-Z0-9-]+\.)*salonstudio\.com\.br|http:\/\/([a-zA-Z0-9-]+)\.localhost(?::\d+)?)$/.test(origin)
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'x-tenant-id', 'x-is-mobile', 'X-Is-Mobile'],
  credentials: true
}));
app.use(cookieParser());
app.use(express.json());
app.use(tenantMiddleware);


// Routes
const authRoutes = express.Router();
authRoutes.post('/login', login);
authRoutes.post('/logout', logout);
authRoutes.get('/me', protect, me);
authRoutes.post('/refresh', refreshToken);
app.use('/api/auth', authRoutes);

// Clientes Routes
const clienteRoutes = express.Router();
clienteRoutes.get('/', protect, requirePermission('clientes'), listClientes);
clienteRoutes.get('/ranking', protect, requirePermission('clientes'), rankingClientes);
clienteRoutes.post('/', protect, requirePermission('clientes', 'criar'), createCliente);
clienteRoutes.put('/:cid', protect, requirePermission('clientes', 'editar'), updateCliente);
clienteRoutes.delete('/:cid', protect, requirePermission('clientes', 'excluir'), deleteCliente);
clienteRoutes.get('/:cid/historico', protect, requirePermission('clientes'), historicoCliente);
app.use('/api/clientes', clienteRoutes);

// Colaboradores Routes
const colabRoutes = express.Router();
colabRoutes.get('/', protect, requirePermission('colaboradores'), listColab);
colabRoutes.post('/', protect, requirePermission('colaboradores', 'criar'), createColab);
colabRoutes.put('/:cid', protect, requirePermission('colaboradores', 'editar'), updateColab);
colabRoutes.delete('/:cid', protect, requirePermission('colaboradores', 'excluir'), deleteColab);
app.use('/api/colaboradores', colabRoutes);

// Servicos Routes
const servRoutes = express.Router();
servRoutes.get('/', protect, requirePermission('servicos'), listServ);
servRoutes.post('/', protect, requirePermission('servicos', 'criar'), createServ);
servRoutes.put('/:sid', protect, requirePermission('servicos', 'editar'), updateServ);
servRoutes.delete('/:sid', protect, requirePermission('servicos', 'excluir'), deleteServ);
app.use('/api/servicos', servRoutes);

// Produtos Routes
const prodRoutes = express.Router();
prodRoutes.get('/', protect, requirePermission('produtos'), listProd);
prodRoutes.post('/', protect, requirePermission('produtos', 'criar'), createProd);
prodRoutes.put('/:pid', protect, requirePermission('produtos', 'editar'), updateProd);
prodRoutes.delete('/:pid', protect, requirePermission('produtos', 'excluir'), deleteProd);
app.use('/api/produtos', prodRoutes);

// Agendamentos Routes
const agendRoutes = express.Router();
agendRoutes.get('/', protect, requirePermission('agenda'), listAgend);
agendRoutes.get('/:aid', protect, requirePermission('agenda'), getAgend);
agendRoutes.post('/', protect, requirePermission('agenda', 'criar'), createAgend);
agendRoutes.put('/:aid', protect, requirePermission('agenda', 'editar'), updateAgend);
agendRoutes.put('/:aid/observacoes', protect, requirePermission('agenda', 'editar'), patchObservacoes);
agendRoutes.delete('/:aid', protect, requirePermission('agenda', 'excluir'), deleteAgend);
agendRoutes.post('/:aid/status', protect, requirePermission('agenda', 'editar'), setStatus);
agendRoutes.post('/:aid/pagamentos', protect, requirePermission('agenda', 'realizar_pagamento'), addPagamentos);
agendRoutes.put('/:aid/pagamentos/:pid', protect, requirePermission('agenda', 'realizar_pagamento'), updateAgendamentoPagamento);
agendRoutes.delete('/:aid/pagamentos/:pid', protect, requirePermission('agenda', 'excluir'), deleteAgendamentoPagamento);
agendRoutes.post('/:aid/aplicar-desconto', protect, requirePermission('agenda', 'realizar_pagamento'), aplicarDescontoAgendamento);
app.use('/api/agendamentos', agendRoutes);

// Dashboard and Relatorios Routes
app.get('/api/dashboard', protect, requirePermission('dashboard'), dashboard);
app.get('/api/dashboard/detail', protect, requirePermission('dashboard'), dashboardDetail);
app.get('/api/relatorios/dre', protect, admin, relatorioDre);
app.get('/api/relatorios/caixa', protect, admin, relatorioCaixa);
app.get('/api/relatorios/produtos', protect, admin, relatorioProdutos);
app.get('/api/relatorios/servicos', protect, admin, relatorioServicos);
app.get('/api/relatorios/resultado-operacional', protect, admin, relatorioResultadoOperacional);

// Users Routes
const userRoutes = express.Router();
userRoutes.get('/', protect, listUsers);
userRoutes.post('/', protect, requirePermission('usuarios', 'criar'), createUser);
userRoutes.put('/:id', protect, updateUser);
userRoutes.delete('/:id', protect, requirePermission('usuarios', 'excluir'), deleteUser);
app.use('/api/users', userRoutes);

// Despesas Routes
const despesaRoutes = express.Router();
despesaRoutes.get('/', protect, requirePermission('despesas'), listDespesas);
despesaRoutes.post('/', protect, requirePermission('despesas', 'criar'), createDespesa);
despesaRoutes.put('/:id', protect, requirePermission('despesas', 'editar'), updateDespesa);
despesaRoutes.delete('/:id', protect, requirePermission('despesas', 'excluir'), deleteDespesa);
app.use('/api/despesas', despesaRoutes);

// Outras Receitas Routes
const outrasReceitasRoutes = express.Router();
outrasReceitasRoutes.get('/', protect, requirePermission('receitas'), listReceitas);
outrasReceitasRoutes.post('/', protect, requirePermission('receitas', 'criar'), createReceita);
outrasReceitasRoutes.put('/:id', protect, requirePermission('receitas', 'editar'), updateReceita);
outrasReceitasRoutes.delete('/:id', protect, requirePermission('receitas', 'excluir'), deleteReceita);
app.use('/api/outras-receitas', outrasReceitasRoutes);

// Vendas Diretas Routes
const vendaDiretaRoutes = express.Router();
vendaDiretaRoutes.get('/', protect, requirePermission('vendas'), listVendas);
vendaDiretaRoutes.get('/:id', protect, requirePermission('vendas'), getVenda);
vendaDiretaRoutes.post('/', protect, requirePermission('vendas', 'criar'), createVenda);
vendaDiretaRoutes.delete('/:id', protect, requirePermission('vendas', 'excluir'), deleteVenda);
vendaDiretaRoutes.post('/:id/pagamentos', protect, requirePermission('vendas', 'realizar_pagamento'), addVendaPagamentos);
vendaDiretaRoutes.put('/:id/pagamentos/:pid', protect, requirePermission('vendas', 'realizar_pagamento'), updateVendaPagamento);
vendaDiretaRoutes.delete('/:id/pagamentos/:pid', protect, requirePermission('vendas', 'excluir'), deleteVendaPagamento);
vendaDiretaRoutes.get('/:id/carrinho', protect, requirePermission('vendas'), getCarrinho);
vendaDiretaRoutes.post('/:id/carrinho/itens', protect, requirePermission('vendas', 'criar'), addItemCarrinho);
vendaDiretaRoutes.put('/:id/carrinho/itens/:itemIndex', protect, requirePermission('vendas', 'editar'), updateItemCarrinho);
vendaDiretaRoutes.delete('/:id/carrinho/itens/:itemIndex', protect, requirePermission('vendas', 'excluir'), removeItemCarrinho);
vendaDiretaRoutes.put('/:id/cliente', protect, requirePermission('vendas', 'editar'), updateVendaCliente);
vendaDiretaRoutes.post('/:id/aplicar-desconto', protect, requirePermission('vendas', 'realizar_pagamento'), aplicarDescontoVenda);
app.use('/api/vendas-diretas', vendaDiretaRoutes);

// Comissões Routes
const comissaoRoutes = express.Router();
comissaoRoutes.get('/', protect, requirePermission('comissoes'), listComissoes);
comissaoRoutes.post('/pagar', protect, requirePermission('comissoes', 'editar'), pagarComissao);
comissaoRoutes.delete('/pagar', protect, requirePermission('comissoes', 'excluir'), desfazerPagamento);
app.use('/api/comissoes', comissaoRoutes);

// Configuracoes Routes
const configRoutes = express.Router();
configRoutes.get('/taxas-cartao', protect, requirePermission('cadastros'), getTaxas);
configRoutes.post('/taxas-cartao', protect, requirePermission('cadastros', 'editar'), saveTaxa);
configRoutes.get('/empresa', protect, getEmpresa);
configRoutes.post('/empresa', protect, requirePermission('configuracoes', 'editar'), saveEmpresa);
configRoutes.get('/whatsapp', protect, requirePermission('configuracoes'), getWhatsappConfig);
configRoutes.post('/whatsapp', protect, requirePermission('configuracoes', 'editar'), saveWhatsappConfig);
configRoutes.get('/whatsapp/historico', protect, requirePermission('agenda'), getWhatsappHistory);
configRoutes.post('/whatsapp/reenviar/:id', protect, requirePermission('agenda', 'editar'), postResendReminder);
configRoutes.get('/whatsapp/local-status', protect, requirePermission('configuracoes'), getLocalStatus);
configRoutes.post('/whatsapp/local-disconnect', protect, requirePermission('configuracoes', 'editar'), postLocalDisconnect);
app.use('/api/configuracoes', configRoutes);

// Categorias Routes
const categoriaRoutes = express.Router();
categoriaRoutes.get('/', protect, listCategorias);
categoriaRoutes.post('/', protect, createCategoria);
categoriaRoutes.put('/:id', protect, updateCategoria);
categoriaRoutes.delete('/:id', protect, deleteCategoria);
app.use('/api/categorias', categoriaRoutes);

// Descontos Routes
const descontoRoutes = express.Router();
descontoRoutes.get('/', protect, requirePermission('cadastros'), listDescontos);
descontoRoutes.post('/', protect, requirePermission('cadastros', 'criar'), createDesconto);
descontoRoutes.put('/:id', protect, requirePermission('cadastros', 'editar'), updateDesconto);
descontoRoutes.delete('/:id', protect, requirePermission('cadastros', 'excluir'), deleteDesconto);
descontoRoutes.post('/validar', protect, validarDescontoAutorizacao);
app.use('/api/descontos', descontoRoutes);

// Perfis de Acesso Routes
const perfilRoutes = express.Router();
perfilRoutes.get('/', protect, admin, listarPerfis);
perfilRoutes.get('/:id', protect, admin, obterPerfil);
perfilRoutes.post('/', protect, admin, criarPerfil);
perfilRoutes.put('/:id', protect, admin, atualizarPerfil);
perfilRoutes.delete('/:id', protect, admin, deletarPerfil);
app.use('/api/perfis-acesso', perfilRoutes);

// Fornecedores Routes
const fornecedorRoutes = express.Router();
fornecedorRoutes.get('/', protect, requirePermission('cadastros'), listFornecedores);
fornecedorRoutes.post('/', protect, requirePermission('cadastros', 'criar'), createFornecedor);
fornecedorRoutes.put('/:id', protect, requirePermission('cadastros', 'editar'), updateFornecedor);
fornecedorRoutes.delete('/:id', protect, requirePermission('cadastros', 'excluir'), deleteFornecedor);
app.use('/api/fornecedores', fornecedorRoutes);

// Estoque Routes
const estoqueRoutes = express.Router();
estoqueRoutes.get('/entradas', protect, listEntradas);
estoqueRoutes.get('/entradas/:id', protect, getEntradaDetail);
estoqueRoutes.post('/entradas', protect, registrarEntrada);
estoqueRoutes.post('/inventario/ajuste', protect, registrarAjusteInventario);
estoqueRoutes.get('/movimentacoes', protect, listMovimentacoes);
app.use('/api/estoque', estoqueRoutes);

// Auditoria Routes
app.get('/api/auditoria/deletados', protect, getDeletados);
app.post('/api/auditoria/restaurar', protect, restoreRecord);

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await connectDB();
    console.log('Database boot sequence successfully completed.');
    await convertLegacyStock();
    
    // Start background WhatsApp reminder processing job
    // startReminderJob();

    // Initialize Local WhatsApp Web Client
    // initLocalClient();
  } catch (dbError) {
    console.error('Critical: Database boot sequence failed:', dbError);
  }
});

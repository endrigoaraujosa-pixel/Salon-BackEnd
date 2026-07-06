import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import 'dotenv/config';

import { addPagamentos, createAgend, deleteAgend, deletePagamento as deleteAgendamentoPagamento, getAgend, listAgend, setStatus, updateAgend, updatePagamento as updateAgendamentoPagamento, patchObservacoes, aplicarDescontoAgendamento } from './controllers/agendamentoController.js';
import { getDeletados, restoreRecord } from './controllers/auditController.js';
import { login, logout, me, refreshToken } from './controllers/authController.js';
import { createCategoria, deleteCategoria, listCategorias, updateCategoria } from './controllers/categoriaController.js';
import { createCliente, deleteCliente, historicoCliente, listClientes, updateCliente, rankingClientes, getCliente } from './controllers/clienteController.js';
import { adicionarCreditoManual, removerCreditoManual, estornarMovimentacao, getExtrato, recalcularSaldoCliente } from './controllers/clienteCreditoController.js';
import { createColab, deleteColab, listColab, updateColab, getComissoesServico, updateComissoesServico } from './controllers/colaboradorController.js';
import { createIndisponibilidade, listIndisponibilidades, updateIndisponibilidade, deleteIndisponibilidade } from './controllers/colaboradorIndisponibilidadeController.js';
import { desfazerPagamento, listComissoes, pagarComissao } from './controllers/comissaoController.js';
import { getTaxas, saveTaxa, deleteTaxa, getEmpresa, saveEmpresa, getPublicEmpresa, getConfiguracaoSistema, saveConfiguracaoSistema } from './controllers/configuracaoController.js';
import { getWhatsappConfig, saveWhatsappConfig, getWhatsappHistory, postResendReminder, getLocalStatus, postLocalDisconnect, startLocalIntegration, getExternalStatus, getExternalQrCode, postCheckWhatsappNumber, listCampanhas, getCampanha, createCampanha, cancelarCampanha } from './modules/whatsapp/whatsapp.controller.js';
import { initLocalClient } from './modules/whatsapp/local-client.js';
import { createDespesa, deleteDespesa, listDespesas, updateDespesa } from './controllers/despesaController.js';
import { createReceita, deleteReceita, listReceitas, updateReceita } from './controllers/outrasReceitasController.js';
import { createProd, deleteProd, listProd, updateProd } from './controllers/produtoController.js';
import {
  dashboard,
  dashboardDetail,
  relatorioCaixa,
  relatorioDre,
  relatorioProdutos,
  relatorioServicos,
  relatorioResultadoOperacional,
  relatorioEstoque,
  relatorioMovimentacaoEstoque,
  relatorioEstoqueAbaixoMinimo,
  relatorioEstoqueSemEstoque,
  relatorioEstoqueValorizacao,
  relatorioEstoqueConsumoInsumos,
  relatorioEstoqueMaisMovimentados,
  relatorioEstoqueSemMovimentacao,
  relatorioEstoqueHistoricoAjustes,
  relatorioEstoqueInventario,
  relatorioEstoquePerdasQuebras,
  relatorioCartoes
} from './controllers/reportController.js';
import { createServ, deleteServ, listServ, updateServ } from './controllers/servicoController.js';
import { createFornecedor, deleteFornecedor, listFornecedores, updateFornecedor } from './controllers/fornecedorController.js';
import { createUser, deleteUser, listUsers, updateUser } from './controllers/userController.js';
import { listarPerfis, obterPerfil, criarPerfil, atualizarPerfil, deletarPerfil } from './controllers/perfilAcessoController.js';
import { listEntradas, getEntradaDetail, registrarEntrada, registrarAjusteInventario, listMovimentacoes, registrarMovimentacao, registrarInventarioAssistido, listProtocolos, autorizarZeragemEstoque } from './controllers/estoqueController.js';
import { listMotivos, createMotivo, updateMotivo } from './controllers/motivoEstoqueController.js';
import { addItemCarrinho, addPagamentos as addVendaPagamentos, createVenda, deleteVenda, deletePagamento as deleteVendaPagamento, getCarrinho, getVenda, listVendas, removeItemCarrinho, updateItemCarrinho, updateCliente as updateVendaCliente, updatePagamento as updateVendaPagamento, aplicarDescontoVenda } from './controllers/vendaDiretaController.js';
import { listDescontos, createDesconto, updateDesconto, deleteDesconto, validarDescontoAutorizacao } from './controllers/descontoController.js';
import { admin, protect, requirePermission } from './middleware/auth.js';
import { listAdquirentes, createAdquirente, updateAdquirente, deleteAdquirente } from './controllers/adquirenteController.js';
import { connectDB } from './config/db.js';
import { startReminderJob } from './jobs/whatsapp-reminder.job.js';
import { tenantMiddleware } from './middleware/tenant.js';

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
    const isAllowed = allowedOrigins.includes(origin) ||
      /^(https:\/\/([a-zA-Z0-9-]+\.)*salonstudio\.com\.br|http:\/\/([a-zA-Z0-9-]+)\.localhost(?::\d+)?)$/.test(origin)
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Tenant-ID',
    'x-tenant-id',
    'x-is-mobile',
    'X-Is-Mobile',
    'x-auth-email',
    'x-auth-password',
    'X-Auth-Email',
    'X-Auth-Password'
  ],
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
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
clienteRoutes.get('/', protect, requirePermission('clientes.visualizar'), listClientes);
clienteRoutes.get('/ranking', protect, requirePermission('clientes.visualizar'), rankingClientes);
clienteRoutes.get('/credito/extrato', protect, requirePermission('clientes.credito.visualizar'), getExtrato);
clienteRoutes.get('/:cid', protect, requirePermission('clientes.visualizar'), getCliente);
clienteRoutes.post('/', protect, requirePermission('clientes.criar'), createCliente);
clienteRoutes.put('/:cid', protect, requirePermission('clientes.editar'), updateCliente);
clienteRoutes.delete('/:cid', protect, requirePermission('clientes.excluir'), deleteCliente);
clienteRoutes.get('/:cid/historico', protect, requirePermission('clientes.visualizar'), historicoCliente);
clienteRoutes.get('/:cid/credito/extrato', protect, requirePermission('clientes.credito.visualizar'), getExtrato);
clienteRoutes.post('/:cid/credito/adicionar', protect, requirePermission('clientes.credito.gerenciar'), adicionarCreditoManual);
clienteRoutes.post('/:cid/credito/remover', protect, requirePermission('clientes.credito.gerenciar'), removerCreditoManual);
clienteRoutes.post('/:cid/credito/estornar/:mid', protect, requirePermission('clientes.credito.gerenciar'), estornarMovimentacao);
clienteRoutes.post('/:cid/credito/recalcular', protect, recalcularSaldoCliente);
app.use('/api/clientes', clienteRoutes);

// Colaboradores Routes
const colabRoutes = express.Router();
colabRoutes.get('/indisponibilidade', protect, requirePermission('colaboradores.indisponibilidade'), listIndisponibilidades);
colabRoutes.post('/indisponibilidade', protect, requirePermission('colaboradores.indisponibilidade'), createIndisponibilidade);
colabRoutes.put('/indisponibilidade/:id', protect, requirePermission('colaboradores.indisponibilidade'), updateIndisponibilidade);
colabRoutes.delete('/indisponibilidade/:id', protect, requirePermission('colaboradores.indisponibilidade'), deleteIndisponibilidade);
colabRoutes.get('/:cid/comissoes-servicos', protect, requirePermission('colaboradores.visualizar'), getComissoesServico);
colabRoutes.put('/:cid/comissoes-servicos', protect, requirePermission('colaboradores.editar'), updateComissoesServico);
colabRoutes.get('/', protect, requirePermission(['colaboradores.visualizar', 'colaboradores.indisponibilidade']), listColab);
colabRoutes.post('/', protect, requirePermission('colaboradores.criar'), createColab);
colabRoutes.put('/:cid', protect, requirePermission('colaboradores.editar'), updateColab);
colabRoutes.delete('/:cid', protect, requirePermission('colaboradores.excluir'), deleteColab);
app.use('/api/colaboradores', colabRoutes);

// Servicos Routes
const servRoutes = express.Router();
servRoutes.get('/', protect, requirePermission('servicos.visualizar'), listServ);
servRoutes.post('/', protect, requirePermission('servicos.criar'), createServ);
servRoutes.put('/:sid', protect, requirePermission('servicos.editar'), updateServ);
servRoutes.delete('/:sid', protect, requirePermission('servicos.excluir'), deleteServ);
app.use('/api/servicos', servRoutes);

// Produtos Routes
const prodRoutes = express.Router();
prodRoutes.get('/', protect, requirePermission('produtos.visualizar'), listProd);
prodRoutes.post('/', protect, requirePermission('produtos.criar'), createProd);
prodRoutes.put('/:pid', protect, requirePermission('produtos.editar'), updateProd);
prodRoutes.delete('/:pid', protect, requirePermission('produtos.excluir'), deleteProd);
app.use('/api/produtos', prodRoutes);

// Agendamentos Routes
const agendRoutes = express.Router();
agendRoutes.get('/', protect, requirePermission('agenda.visualizar'), listAgend);
agendRoutes.get('/:aid', protect, requirePermission('agenda.visualizar'), getAgend);
agendRoutes.post('/', protect, requirePermission('agenda.criar'), createAgend);
agendRoutes.put('/:aid', protect, requirePermission('agenda.editar'), updateAgend);
agendRoutes.put('/:aid/observacoes', protect, requirePermission('agenda.editar'), patchObservacoes);
agendRoutes.delete('/:aid', protect, requirePermission('agenda.excluir'), deleteAgend);
agendRoutes.post('/:aid/status', protect, requirePermission('agenda.status'), setStatus);
agendRoutes.post('/:aid/pagamentos', protect, requirePermission('agenda.pagamento'), addPagamentos);
agendRoutes.put('/:aid/pagamentos/:pid', protect, requirePermission('agenda.pagamento'), updateAgendamentoPagamento);
agendRoutes.delete('/:aid/pagamentos/:pid', protect, requirePermission('agenda.pagamento.excluir'), deleteAgendamentoPagamento);
agendRoutes.post('/:aid/aplicar-desconto', protect, requirePermission('agenda.aplicar_desconto'), aplicarDescontoAgendamento);
app.use('/api/agendamentos', agendRoutes);

// Dashboard and Relatorios Routes
app.get('/api/dashboard', protect, requirePermission('dashboard'), dashboard);
app.get('/api/dashboard/detail', protect, requirePermission('dashboard'), dashboardDetail);
app.get('/api/relatorios/dre', protect, requirePermission('relatorios.dre'), relatorioDre);
app.get('/api/relatorios/cartoes', protect, requirePermission('relatorios.cartoes'), relatorioCartoes);
app.get('/api/relatorios/caixa', protect, requirePermission('relatorios.caixa'), relatorioCaixa);
app.get('/api/relatorios/produtos', protect, requirePermission('relatorios.vendas'), relatorioProdutos);
app.get('/api/relatorios/servicos', protect, requirePermission('relatorios.vendas'), relatorioServicos);
app.get('/api/relatorios/resultado-operacional', protect, requirePermission('relatorios.operacional'), relatorioResultadoOperacional);
app.get('/api/relatorios/estoque', protect, requirePermission('relatorios.estoque'), relatorioEstoque);
app.get('/api/relatorios/estoque/movimentacao', protect, requirePermission('relatorios.estoque'), relatorioMovimentacaoEstoque);
app.get('/api/relatorios/estoque/abaixo-minimo', protect, requirePermission('relatorios.estoque'), relatorioEstoqueAbaixoMinimo);
app.get('/api/relatorios/estoque/sem-estoque', protect, requirePermission('relatorios.estoque'), relatorioEstoqueSemEstoque);
app.get('/api/relatorios/estoque/valorizacao', protect, requirePermission('relatorios.estoque'), relatorioEstoqueValorizacao);
app.get('/api/relatorios/estoque/consumo-insumos', protect, requirePermission('relatorios.estoque'), relatorioEstoqueConsumoInsumos);
app.get('/api/relatorios/estoque/mais-movimentados', protect, requirePermission('relatorios.estoque'), relatorioEstoqueMaisMovimentados);
app.get('/api/relatorios/estoque/sem-movimentacao', protect, requirePermission('relatorios.estoque'), relatorioEstoqueSemMovimentacao);
app.get('/api/relatorios/estoque/historico-ajustes', protect, requirePermission('relatorios.estoque'), relatorioEstoqueHistoricoAjustes);
app.get('/api/relatorios/estoque/inventario', protect, requirePermission('relatorios.estoque'), relatorioEstoqueInventario);
app.get('/api/relatorios/estoque/perdas-quebras', protect, requirePermission('relatorios.estoque'), relatorioEstoquePerdasQuebras);

// Users Routes
const userRoutes = express.Router();
userRoutes.get('/', protect, listUsers);
userRoutes.post('/', protect, requirePermission('usuarios.criar'), createUser);
userRoutes.put('/:id', protect, updateUser);
userRoutes.delete('/:id', protect, requirePermission('usuarios.excluir'), deleteUser);
app.use('/api/users', userRoutes);

// Despesas Routes
const despesaRoutes = express.Router();
despesaRoutes.get('/', protect, requirePermission('despesas.visualizar'), listDespesas);
despesaRoutes.post('/', protect, requirePermission('despesas.criar'), createDespesa);
despesaRoutes.put('/:id', protect, requirePermission('despesas.editar'), updateDespesa);
despesaRoutes.delete('/:id', protect, requirePermission('despesas.excluir'), deleteDespesa);
app.use('/api/despesas', despesaRoutes);

// Outras Receitas Routes
const outrasReceitasRoutes = express.Router();
outrasReceitasRoutes.get('/', protect, requirePermission('receitas.visualizar'), listReceitas);
outrasReceitasRoutes.post('/', protect, requirePermission('receitas.criar'), createReceita);
outrasReceitasRoutes.put('/:id', protect, requirePermission('receitas.editar'), updateReceita);
outrasReceitasRoutes.delete('/:id', protect, requirePermission('receitas.excluir'), deleteReceita);
app.use('/api/outras-receitas', outrasReceitasRoutes);

// Vendas Diretas Routes
const vendaDiretaRoutes = express.Router();
vendaDiretaRoutes.get('/', protect, requirePermission('vendas.visualizar'), listVendas);
vendaDiretaRoutes.get('/:id', protect, requirePermission('vendas.visualizar'), getVenda);
vendaDiretaRoutes.post('/', protect, requirePermission('vendas.criar'), createVenda);
vendaDiretaRoutes.delete('/:id', protect, requirePermission('vendas.cancelar'), deleteVenda);
vendaDiretaRoutes.post('/:id/pagamentos', protect, requirePermission('vendas.pagamento'), addVendaPagamentos);
vendaDiretaRoutes.put('/:id/pagamentos/:pid', protect, requirePermission('vendas.pagamento'), updateVendaPagamento);
vendaDiretaRoutes.delete('/:id/pagamentos/:pid', protect, requirePermission('vendas.cancelar'), deleteVendaPagamento);
vendaDiretaRoutes.get('/:id/carrinho', protect, requirePermission('vendas.visualizar'), getCarrinho);
vendaDiretaRoutes.post('/:id/carrinho/itens', protect, requirePermission('vendas.criar'), addItemCarrinho);
vendaDiretaRoutes.put('/:id/carrinho/itens/:itemIndex', protect, requirePermission('vendas.editar'), updateItemCarrinho);
vendaDiretaRoutes.delete('/:id/carrinho/itens/:itemIndex', protect, requirePermission('vendas.editar'), removeItemCarrinho);
vendaDiretaRoutes.put('/:id/cliente', protect, requirePermission('vendas.editar'), updateVendaCliente);
vendaDiretaRoutes.post('/:id/aplicar-desconto', protect, requirePermission('vendas.aplicar_desconto'), aplicarDescontoVenda);
app.use('/api/vendas-diretas', vendaDiretaRoutes);

// Comissões Routes
const comissaoRoutes = express.Router();
comissaoRoutes.get('/', protect, requirePermission('comissoes.visualizar'), listComissoes);
comissaoRoutes.post('/pagar', protect, requirePermission('comissoes.pagar'), pagarComissao);
comissaoRoutes.delete('/pagar', protect, requirePermission('comissoes.estornar'), desfazerPagamento);
app.use('/api/comissoes', comissaoRoutes);

// Configuracoes Routes
const configRoutes = express.Router();
configRoutes.get('/taxas-cartao', protect, requirePermission('cadastros.taxas'), getTaxas);
configRoutes.post('/taxas-cartao', protect, requirePermission('cadastros.taxas'), saveTaxa);
configRoutes.delete('/taxas-cartao/:forma_pagamento', protect, requirePermission('cadastros.taxas'), deleteTaxa);
configRoutes.get('/empresa', protect, getEmpresa);
configRoutes.post('/empresa', protect, requirePermission('configuracoes.empresa'), saveEmpresa);
configRoutes.get('/sistema', protect, getConfiguracaoSistema);
configRoutes.post('/sistema', protect, requirePermission('configuracoes.sistema'), saveConfiguracaoSistema);
configRoutes.get('/whatsapp', protect, requirePermission(['configuracoes.whatsapp', 'agenda.whatsapp_historico', 'configuracoes.whatsapp_mensagem_massa']), getWhatsappConfig);
configRoutes.post('/whatsapp', protect, requirePermission(['configuracoes.whatsapp', 'configuracoes.whatsapp_mensagem_massa']), saveWhatsappConfig);
configRoutes.get('/whatsapp/historico', protect, requirePermission('agenda.whatsapp_historico'), getWhatsappHistory);
configRoutes.post('/whatsapp/reenviar/:id', protect, requirePermission('agenda.whatsapp_historico'), postResendReminder);
configRoutes.get('/whatsapp/local-status', protect, requirePermission('configuracoes.whatsapp'), getLocalStatus);
configRoutes.post('/whatsapp/iniciar-integracao', protect, requirePermission('configuracoes.whatsapp'), startLocalIntegration);
configRoutes.get('/whatsapp/status-integracao/:instance', protect, requirePermission('configuracoes.whatsapp'), getExternalStatus);
configRoutes.get('/whatsapp/qr-code/:instance', protect, requirePermission('configuracoes.whatsapp'), getExternalQrCode);
configRoutes.post('/whatsapp/local-disconnect', protect, requirePermission('configuracoes.whatsapp'), postLocalDisconnect);
configRoutes.post('/whatsapp/check-number', protect, postCheckWhatsappNumber);
app.get('/api/configuracoes/empresa/public', getPublicEmpresa);

// Campanhas de Mensagem em Massa
const campanhaRoutes = express.Router();
campanhaRoutes.get('/', protect, requirePermission('configuracoes.whatsapp_mensagem_massa'), listCampanhas);
campanhaRoutes.get('/:id', protect, requirePermission('configuracoes.whatsapp_mensagem_massa'), getCampanha);
campanhaRoutes.post('/', protect, requirePermission('configuracoes.whatsapp_mensagem_massa'), createCampanha);
campanhaRoutes.post('/:id/cancelar', protect, requirePermission('configuracoes.whatsapp_mensagem_massa'), cancelarCampanha);
app.use('/api/whatsapp/campanhas', campanhaRoutes);
configRoutes.get('/motivos-estoque', protect, requirePermission(['cadastros.motivos_estoque', 'estoque.movimentar', 'estoque.entrada', 'estoque.visualizar']), listMotivos);
configRoutes.post('/motivos-estoque', protect, requirePermission('cadastros.motivos_estoque'), createMotivo);
configRoutes.put('/motivos-estoque/:id', protect, requirePermission('cadastros.motivos_estoque'), updateMotivo);
app.use('/api/configuracoes', configRoutes);

// Categorias Routes
const categoriaRoutes = express.Router();
categoriaRoutes.get('/', protect, requirePermission('cadastros.categorias'), listCategorias);
categoriaRoutes.post('/', protect, requirePermission('cadastros.categorias'), createCategoria);
categoriaRoutes.put('/:id', protect, requirePermission('cadastros.categorias'), updateCategoria);
categoriaRoutes.delete('/:id', protect, requirePermission('cadastros.categorias'), deleteCategoria);
app.use('/api/categorias', categoriaRoutes);

// Descontos Routes
const descontoRoutes = express.Router();
descontoRoutes.get('/', protect, requirePermission(['cadastros.descontos', 'agenda.aplicar_desconto', 'vendas.aplicar_desconto']), listDescontos);
descontoRoutes.post('/', protect, requirePermission('cadastros.descontos'), createDesconto);
descontoRoutes.put('/:id', protect, requirePermission('cadastros.descontos'), updateDesconto);
descontoRoutes.delete('/:id', protect, requirePermission('cadastros.descontos'), deleteDesconto);
descontoRoutes.post('/validar', protect, validarDescontoAutorizacao);
app.use('/api/descontos', descontoRoutes);

// Perfis de Acesso Routes
const perfilRoutes = express.Router();
perfilRoutes.get('/', protect, requirePermission('perfis.visualizar'), listarPerfis);
perfilRoutes.get('/:id', protect, requirePermission('perfis.visualizar'), obterPerfil);
perfilRoutes.post('/', protect, requirePermission('perfis.criar'), criarPerfil);
perfilRoutes.put('/:id', protect, requirePermission('perfis.editar'), atualizarPerfil);
perfilRoutes.delete('/:id', protect, requirePermission('perfis.excluir'), deletarPerfil);
app.use('/api/perfis-acesso', perfilRoutes);

// Fornecedores Routes
const fornecedorRoutes = express.Router();
fornecedorRoutes.get('/', protect, requirePermission(['cadastros.fornecedores', 'estoque.entrada']), listFornecedores);
fornecedorRoutes.post('/', protect, requirePermission('cadastros.fornecedores'), createFornecedor);
fornecedorRoutes.put('/:id', protect, requirePermission('cadastros.fornecedores'), updateFornecedor);
fornecedorRoutes.delete('/:id', protect, requirePermission('cadastros.fornecedores'), deleteFornecedor);
app.use('/api/fornecedores', fornecedorRoutes);

// Adquirentes Routes
const adquirenteRoutes = express.Router();
adquirenteRoutes.get('/', protect, requirePermission('cadastros.adquirentes'), listAdquirentes);
adquirenteRoutes.post('/', protect, requirePermission('cadastros.adquirentes'), createAdquirente);
adquirenteRoutes.put('/:id', protect, requirePermission('cadastros.adquirentes'), updateAdquirente);
adquirenteRoutes.delete('/:id', protect, requirePermission('cadastros.adquirentes'), deleteAdquirente);
app.use('/api/adquirentes', adquirenteRoutes);

// Estoque Routes
const estoqueRoutes = express.Router();
estoqueRoutes.get('/entradas', protect, requirePermission('estoque.visualizar'), listEntradas);
estoqueRoutes.get('/entradas/:id', protect, requirePermission('estoque.visualizar'), getEntradaDetail);
estoqueRoutes.post('/entradas', protect, requirePermission('estoque.entrada'), registrarEntrada);
estoqueRoutes.post('/inventario/ajuste', protect, requirePermission('estoque.ajustar'), registrarAjusteInventario);
estoqueRoutes.post('/inventario/assistido', protect, requirePermission('estoque.inventariar'), registrarInventarioAssistido);
estoqueRoutes.post('/inventario/autorizar-zeragem', protect, requirePermission('estoque.zerar'), autorizarZeragemEstoque);
estoqueRoutes.get('/inventario/protocolos', protect, requirePermission('estoque.visualizar'), listProtocolos);
estoqueRoutes.post('/movimentacao', protect, requirePermission('estoque.movimentar'), registrarMovimentacao);
estoqueRoutes.get('/movimentacoes', protect, requirePermission(['estoque.visualizar', 'produtos.visualizar']), listMovimentacoes);
app.use('/api/estoque', estoqueRoutes);

// Auditoria Routes
app.get('/api/auditoria/deletados', protect, requirePermission('auditoria.visualizar'), getDeletados);
app.post('/api/auditoria/restaurar', protect, requirePermission('auditoria.restaurar'), restoreRecord);

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await connectDB();
    console.log('Database boot sequence successfully completed.');
    // Start background WhatsApp reminder processing job
    // startReminderJob();

    // Initialize Local WhatsApp Web Client
    // initLocalClient();
  } catch (dbError) {
    console.error('Critical: Database boot sequence failed:', dbError);
  }
});

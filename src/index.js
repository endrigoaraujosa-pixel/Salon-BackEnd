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
import { listVendas, getVenda, createVenda, deleteVenda, addPagamentos as addVendaPagamentos, updatePagamento as updateVendaPagamento, deletePagamento as deleteVendaPagamento, getCarrinho, addItemCarrinho, updateItemCarrinho, removeItemCarrinho, updateCliente as updateVendaCliente } from './controllers/vendaDiretaController.js';
import { listComissoes, pagarComissao, desfazerPagamento } from './controllers/comissaoController.js';
import { listReceitas, createReceita, updateReceita, deleteReceita } from './controllers/outrasReceitasController.js';
import { listCategorias, createCategoria, updateCategoria, deleteCategoria } from './controllers/categoriaController.js';
import { getDeletados, restoreRecord } from './controllers/auditController.js';

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
// Rotas de gerenciamento de carrinho
vendaDiretaRoutes.get('/:id/carrinho', protect, getCarrinho);
vendaDiretaRoutes.post('/:id/carrinho/itens', protect, addItemCarrinho);
vendaDiretaRoutes.put('/:id/carrinho/itens/:itemIndex', protect, updateItemCarrinho);
vendaDiretaRoutes.delete('/:id/carrinho/itens/:itemIndex', protect, removeItemCarrinho);
vendaDiretaRoutes.put('/:id/cliente', protect, updateVendaCliente);
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

// Categorias Routes
const categoriaRoutes = express.Router();
categoriaRoutes.get('/', protect, listCategorias);
categoriaRoutes.post('/', protect, createCategoria);
categoriaRoutes.put('/:id', protect, updateCategoria);
categoriaRoutes.delete('/:id', protect, deleteCategoria);
app.use('/api/categorias', categoriaRoutes);

// Auditoria Routes
app.get('/api/auditoria/deletados', protect, getDeletados);
app.post('/api/auditoria/restaurar', protect, restoreRecord);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
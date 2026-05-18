import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { connectDB, sequelize } from './config/db.js';
import User from './models/User.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

import { login, logout, me } from './controllers/authController.js';
import { protect } from './middleware/auth.js';
import { listClientes, createCliente, updateCliente, deleteCliente, historicoCliente } from './controllers/clienteController.js';
import { listColab, createColab, updateColab, deleteColab } from './controllers/colaboradorController.js';
import { listServ, createServ, updateServ, deleteServ } from './controllers/servicoController.js';
import { listProd, createProd, updateProd, deleteProd } from './controllers/produtoController.js';
import { listAgend, getAgend, createAgend, updateAgend, deleteAgend, setStatus, addPagamentos } from './controllers/agendamentoController.js';
import { dashboard, relatorioDre, relatorioCaixa } from './controllers/reportController.js';

const app = express();

// Middleware
app.use(cors({
  origin: [
    'http://localhost:4000',
    'https://studiosalon-ashen.vercel.app'
  ], // Origem do seu frontend
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
app.use('/api/agendamentos', agendRoutes);

// Dashboard and Relatorios Routes
app.get('/api/dashboard', protect, dashboard);
app.get('/api/relatorios/dre', protect, relatorioDre);
app.get('/api/relatorios/caixa', protect, relatorioCaixa);

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
      ativo: true
    });
    console.log('Admin user seeded');
  } else {
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

const startServer = async () => {
  await connectDB();

  // Sync models
  await sequelize.sync();

  await seedAdmin();

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};

startServer();

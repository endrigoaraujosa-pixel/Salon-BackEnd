import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Sequelize, DataTypes } from 'sequelize';
import { tenantStorage } from '../src/config/tenantContext.js';

process.env.JWT_SECRET = 'test-secret';
const db = new Sequelize('sqlite::memory:', { logging: false });
mock.module('../src/config/db.js', { namedExports: { sequelize: db, connectDB: async () => {} } });
mock.module('../src/modules/whatsapp/whatsapp.service.js', { namedExports: { getConfig: async () => ({ ativo: false }) } });
mock.module('../src/modules/whatsapp/provider/whatsapp.provider.js', { defaultExport: { sendMessage: async () => ({ success: true }) } });

const { getServicoModel } = await import('../src/models/Servico.js');
const { getColaboradorModel } = await import('../src/models/Colaborador.js');
const { getAgendamentoOnlineDisponibilidadeModel } = await import('../src/models/AgendamentoOnlineDisponibilidade.js');
const { getColaboradorOnlineDisponibilidadeModel } = await import('../src/models/ColaboradorOnlineDisponibilidade.js');
const { getColaboradorComissaoServicoModel } = await import('../src/models/ColaboradorComissaoServico.js');
const { getAgendamentoOnlineSolicitacaoModel } = await import('../src/models/AgendamentoOnlineSolicitacao.js');
const { getAgendamentoModel } = await import('../src/models/Agendamento.js');
const { getConfiguracaoSistemaModel } = await import('../src/models/ConfiguracaoSistema.js');
const { getClienteModel } = await import('../src/models/Cliente.js');
const { getColaboradorIndisponibilidadeModel } = await import('../src/models/ColaboradorIndisponibilidade.js');

const online = await import('../src/controllers/onlineController.js');

const tenant = fn => tenantStorage.run('company_test', fn);

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});

const call = async (fn, req) => {
  const res = response();
  await tenant(() => fn(req, res));
  return res;
};

let servico, colabAna, colabBruno;

before(async () => tenant(async () => {
  for (const get of [
    getServicoModel, getColaboradorModel, getAgendamentoOnlineDisponibilidadeModel,
    getColaboradorOnlineDisponibilidadeModel, getColaboradorComissaoServicoModel,
    getAgendamentoOnlineSolicitacaoModel, getAgendamentoModel, getConfiguracaoSistemaModel,
    getClienteModel, getColaboradorIndisponibilidadeModel
  ]) {
    await get().sync();
  }

  await getConfiguracaoSistemaModel().create({ agendamento_online_ativo: true });

  // Regra geral do salão: Segunda (1) a Domingo (0) das 08:00 às 18:00
  for (let dia = 0; dia <= 6; dia++) {
    await getAgendamentoOnlineDisponibilidadeModel().create({
      dia_semana: dia,
      hora_inicio: '08:00',
      hora_fim: '18:00',
      ativo: true
    });
  }

  // Criar serviço
  servico = await getServicoModel().create({
    id: 'servico-corte-uuid',
    nome: 'Corte de Cabelo',
    duracao_minutos: 30,
    valor: 50,
    ativo: true,
    deletado: 'N',
    disponivel_online: true
  });

  // Criar 2 colaboradores
  colabAna = await getColaboradorModel().create({
    id: 'colab-ana-uuid',
    nome: 'Ana Silva',
    ativo: true,
    deletado: 'N',
    agendamento_online_ativo: true
  });

  colabBruno = await getColaboradorModel().create({
    id: 'colab-bruno-uuid',
    nome: 'Bruno Costa',
    ativo: true,
    deletado: 'N',
    agendamento_online_ativo: true
  });
}));

after(() => db.close());

test('Reserva com "Qualquer Profissional" atribui o primeiro livre se outro estiver ocupado', async () => tenant(async () => {
  const dataTeste = '2026-10-15T10:00:00';
  const Agendamento = getAgendamentoModel();

  // Ana possui um agendamento no horário de 10:00
  await Agendamento.create({
    id: 'ag-ana-1000',
    numero: 1,
    cliente_id: 'cli-1',
    cliente_nome: 'Cliente Exemplo',
    data_hora: new Date(dataTeste),
    status: 'agendado',
    itens: [{ servico_id: servico.id, duracao: 30, colaborador_id: colabAna.id }],
    profissionais: [{ id: colabAna.id, nome: colabAna.nome }],
    valor_total: 50,
    deletado: 'N'
  });

  // Reservar horário de 10:00 com Qualquer Profissional (profissional_id = null)
  const resReservar = await call(online.reservarHorario, {
    body: {
      data_hora: dataTeste,
      servicos: [servico.id],
      profissional_id: null
    }
  });

  assert.equal(resReservar.statusCode, 200);
  assert.equal(resReservar.body.ok, true);
  assert.ok(resReservar.body.solicitacaoId);

  // Verificar se a solicitação foi gravada atribuindo Bruno (primeiro livre)
  const Solicitacao = getAgendamentoOnlineSolicitacaoModel();
  const sol = await Solicitacao.findByPk(resReservar.body.solicitacaoId);
  assert.ok(sol);
  assert.equal(sol.profissional_id, colabBruno.id);
}));

test('Reserva com "Qualquer Profissional" falha se TODOS os profissionais estiverem ocupados', async () => tenant(async () => {
  const dataTesteOcupado = '2026-10-15T11:00:00';
  const Agendamento = getAgendamentoModel();

  // Ana e Bruno ocupados às 11:00
  await Agendamento.create({
    id: 'ag-ana-1100',
    numero: 2,
    cliente_id: 'cli-1',
    cliente_nome: 'Cliente 1',
    data_hora: new Date(dataTesteOcupado),
    status: 'agendado',
    itens: [{ servico_id: servico.id, duracao: 30, colaborador_id: colabAna.id }],
    profissionais: [{ id: colabAna.id, nome: colabAna.nome }],
    valor_total: 50,
    deletado: 'N'
  });

  await Agendamento.create({
    id: 'ag-bruno-1100',
    numero: 3,
    cliente_id: 'cli-2',
    cliente_nome: 'Cliente 2',
    data_hora: new Date(dataTesteOcupado),
    status: 'agendado',
    itens: [{ servico_id: servico.id, duracao: 30, colaborador_id: colabBruno.id }],
    profissionais: [{ id: colabBruno.id, nome: colabBruno.nome }],
    valor_total: 50,
    deletado: 'N'
  });

  // Tentar reservar às 11:00 com Qualquer Profissional
  const resReservar = await call(online.reservarHorario, {
    body: {
      data_hora: dataTesteOcupado,
      servicos: [servico.id],
      profissional_id: null
    }
  });

  assert.equal(resReservar.statusCode, 400);
  assert.equal(resReservar.body.detail, 'Este horário já não está mais disponível.');
}));

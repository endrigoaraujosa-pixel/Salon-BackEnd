import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Sequelize } from 'sequelize';
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
  statusCode: 200, body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});
const call = async (fn, req) => {
  const res = response();
  await tenant(() => fn(req, res));
  return res;
};

let servicoA, servicoB, profissional1, profissional2;

before(async () => tenant(async () => {
  for (const get of [
    getServicoModel, getColaboradorModel, getAgendamentoOnlineDisponibilidadeModel,
    getColaboradorOnlineDisponibilidadeModel, getColaboradorComissaoServicoModel,
    getAgendamentoOnlineSolicitacaoModel, getAgendamentoModel, getConfiguracaoSistemaModel,
    getClienteModel, getColaboradorIndisponibilidadeModel
  ]) await get().sync();

  await getConfiguracaoSistemaModel().create({ agendamento_online_ativo: true });
  for (let dia = 0; dia <= 6; dia++) {
    await getAgendamentoOnlineDisponibilidadeModel().create({
      dia_semana: dia, hora_inicio: '08:00', hora_fim: '18:00', ativo: true
    });
  }
  servicoA = await getServicoModel().create({
    id: 'servico-a-uuid', nome: 'Serviço A', duracao_minutos: 30, valor: 50,
    ativo: true, deletado: 'N', disponivel_online: true
  });
  servicoB = await getServicoModel().create({
    id: 'servico-b-uuid', nome: 'Serviço B', duracao_minutos: 30, valor: 60,
    ativo: true, deletado: 'N', disponivel_online: true
  });
  profissional1 = await getColaboradorModel().create({
    id: 'profissional-1-uuid', nome: 'Profissional 1', ativo: true,
    deletado: 'N', agendamento_online_ativo: true
  });
  profissional2 = await getColaboradorModel().create({
    id: 'profissional-2-uuid', nome: 'Profissional 2', ativo: true,
    deletado: 'N', agendamento_online_ativo: true
  });
  await getColaboradorComissaoServicoModel().bulkCreate([
    { colaborador_id: profissional1.id, servico_id: servicoA.id, agendamento_online_ativo: true },
    { colaborador_id: profissional1.id, servico_id: servicoB.id, agendamento_online_ativo: false },
    { colaborador_id: profissional2.id, servico_id: servicoA.id, agendamento_online_ativo: false },
    { colaborador_id: profissional2.id, servico_id: servicoB.id, agendamento_online_ativo: true }
  ]);
}));

after(() => db.close());

test('lista profissionais que realizam ao menos um dos serviços selecionados', async () => {
  const res = await call(online.getProfissionaisOnline, {
    query: { servicos: `${servicoA.id},${servicoB.id}` }
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(new Set(res.body.map(p => p.id)), new Set([profissional1.id, profissional2.id]));
});

test('retorna disponibilidade quando profissionais diferentes cobrem os serviços', async () => {
  const res = await call(online.getDisponibilidadeOnline, {
    query: { data: '2026-10-20', servicos: [servicoA.id, servicoB.id] }, body: {}
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.horarios.includes('10:00'));
});

test('reserva associa cada serviço ao profissional habilitado correspondente', async () => {
  const res = await call(online.reservarHorario, {
    body: {
      data_hora: '2026-10-21T11:00:00',
      servicos: [servicoA.id, servicoB.id],
      profissional_id: null
    }
  });
  assert.equal(res.statusCode, 200);
  const solicitacao = await tenant(() =>
    getAgendamentoOnlineSolicitacaoModel().findByPk(res.body.solicitacaoId)
  );
  const itens = typeof solicitacao.servicos === 'string' ? JSON.parse(solicitacao.servicos) : solicitacao.servicos;
  assert.deepEqual(itens, [
    { servico_id: servicoA.id, colaborador_id: profissional1.id },
    { servico_id: servicoB.id, colaborador_id: profissional2.id }
  ]);
  assert.equal(solicitacao.profissional_id, null);
});

test('profissional escolhido participa e os demais serviços são redistribuídos', async () => {
  const res = await call(online.reservarHorario, {
    body: {
      data_hora: '2026-10-22T12:00:00',
      servicos: [servicoA.id, servicoB.id],
      profissional_id: profissional1.id
    }
  });
  assert.equal(res.statusCode, 200);
  const solicitacao = await tenant(() =>
    getAgendamentoOnlineSolicitacaoModel().findByPk(res.body.solicitacaoId)
  );
  const itens = typeof solicitacao.servicos === 'string' ? JSON.parse(solicitacao.servicos) : solicitacao.servicos;
  assert.equal(itens[0].colaborador_id, profissional1.id);
  assert.equal(itens[1].colaborador_id, profissional2.id);
  assert.equal(solicitacao.profissional_id, profissional1.id);
});

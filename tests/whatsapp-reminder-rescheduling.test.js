import { test, before, beforeEach, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Sequelize } from 'sequelize';

// Banco em memória: este teste não acessa o PostgreSQL nem envia mensagens.
const db = new Sequelize('sqlite::memory:', { logging: false });
mock.module('../src/config/db.js', { namedExports: { sequelize: db, connectDB: async () => {} } });
let sends = 0;
mock.module('../src/modules/whatsapp/provider/whatsapp.provider.js', {
  defaultExport: { sendMessage: async () => { sends++; return { success: true }; } }
});

const { getAgendamentoModel } = await import('../src/models/Agendamento.js');
const { getClienteModel } = await import('../src/models/Cliente.js');
const { getWhatsappConfigModel } = await import('../src/models/WhatsappConfig.js');
const { getWhatsappLembreteModel } = await import('../src/models/WhatsappLembrete.js');
const { generateReminders, cancelReminders, generateThankYouReminder } = await import('../src/modules/whatsapp/reminder.service.js');
const { runSingleTenantProcessReminders } = await import('../src/jobs/whatsapp-reminder.job.js');

before(async () => {
  await Promise.all([
    getAgendamentoModel().sync(),
    getClienteModel().sync(),
    getWhatsappConfigModel().sync(),
    getWhatsappLembreteModel().sync()
  ]);
});

beforeEach(async () => {
  sends = 0;
  await getWhatsappLembreteModel().destroy({ where: {} });
  await getAgendamentoModel().destroy({ where: {} });
  await getClienteModel().destroy({ where: {} });
  await getWhatsappConfigModel().destroy({ where: {} });
  await getWhatsappConfigModel().create({ ativo: 1, lembrete_24h: 1, lembrete_2h: 1, lembrete_1h: 0 });
  await getClienteModel().create({ id: 'cliente-teste', nome: 'Cliente Teste', telefone: '81999999999' });
});

after(async () => {
  await db.close();
  mock.restoreAll();
});

test('reagendar um atendimento para data passada cancela lembretes pendentes sem apagá-los', async () => {
  const Agendamento = getAgendamentoModel();
  const agendamento = await Agendamento.create({
    id: 'agendamento-teste',
    cliente_id: 'cliente-teste',
    data_hora: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: 'agendado'
  });

  await generateReminders(agendamento);
  let lembretes = await getWhatsappLembreteModel().findAll({ order: [['tipo_lembrete', 'ASC']] });
  assert.equal(lembretes.length, 2);
  assert.ok(lembretes.every(lembrete => lembrete.status === 'Pendente'));

  await agendamento.update({ data_hora: new Date(Date.now() - 24 * 60 * 60 * 1000) });
  await generateReminders(agendamento);

  lembretes = await getWhatsappLembreteModel().findAll({ order: [['tipo_lembrete', 'ASC']] });
  assert.equal(lembretes.length, 2);
  assert.ok(lembretes.every(lembrete => lembrete.status === 'Cancelado'));
  assert.ok(lembretes.every(lembrete => /data passada/i.test(lembrete.erro)));
});

test('cancelar lembretes de um atendimento concluído preserva os registros no histórico', async () => {
  const Agendamento = await getAgendamentoModel().create({
    id: 'agendamento-concluido',
    cliente_id: 'cliente-teste',
    data_hora: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    status: 'agendado'
  });

  await generateReminders(Agendamento);
  const reminders = await getWhatsappLembreteModel().findAll({ order: [['id', 'ASC']] });
  await reminders[0].update({ status: 'Falhou' });
  await cancelReminders(Agendamento.id);

  const lembretes = await getWhatsappLembreteModel().findAll({ order: [['id', 'ASC']] });
  assert.equal(lembretes.length, 2);
  assert.ok(lembretes.every(lembrete => lembrete.status === 'Cancelado'));
  assert.ok(lembretes.every(lembrete => lembrete.tipo_lembrete.includes('_cancelado_')));
});

test('reabrir atendimento futuro como agendado ou confirmado cria novos lembretes', async () => {
  await getWhatsappConfigModel().update({
    agradecimento_ativo: 1,
    agradecimento_modelo_mensagem: 'Obrigado pela visita!'
  }, { where: {} });

  for (const status of ['agendado', 'confirmado']) {
    const agendamento = await getAgendamentoModel().create({
      id: `agendamento-reaberto-${status}`,
      cliente_id: 'cliente-teste',
      data_hora: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: 'concluido'
    });

    await generateReminders(agendamento);
    await generateThankYouReminder(agendamento);
    await cancelReminders(agendamento.id);
    await agendamento.update({ status });
    await generateReminders(agendamento);

    const lembretes = await getWhatsappLembreteModel().findAll({
      where: { agendamento_id: agendamento.id },
      order: [['id', 'ASC']]
    });
    assert.equal(lembretes.length, 5);
    assert.equal(lembretes.filter(lembrete => lembrete.status === 'Cancelado').length, 3);
    assert.equal(lembretes.filter(lembrete => lembrete.status === 'Pendente').length, 2);
    assert.deepEqual(
      lembretes.filter(lembrete => lembrete.status === 'Pendente').map(lembrete => lembrete.tipo_lembrete).sort(),
      ['24h', '2h']
    );
    assert.equal(lembretes.find(lembrete => lembrete.tipo_lembrete.startsWith('agradecimento')).status, 'Cancelado');
  }
});

test('worker não envia lembrete pendente quando a data do atendimento já passou', async () => {
  const agendamento = await getAgendamentoModel().create({
    id: 'agendamento-atrasado',
    cliente_id: 'cliente-teste',
    data_hora: new Date(Date.now() - 24 * 60 * 60 * 1000),
    status: 'agendado',
    itens: [{ nome: 'Serviço teste', valor: 0 }]
  });
  const lembrete = await getWhatsappLembreteModel().create({
    agendamento_id: agendamento.id,
    tipo_lembrete: '24h',
    data_programada: new Date(Date.now() - 60 * 1000),
    status: 'Pendente',
    tentativas: 0
  });

  await runSingleTenantProcessReminders('default');

  await lembrete.reload();
  assert.equal(sends, 0);
  assert.equal(lembrete.status, 'Cancelado');
  assert.match(lembrete.erro, /data passada/i);
});

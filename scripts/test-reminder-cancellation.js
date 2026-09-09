import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sequelize } from '../src/config/db.js';
import { tenantStorage } from '../src/config/tenantContext.js';
import { getClienteModel } from '../src/models/Cliente.js';
import { getAgendamentoModel } from '../src/models/Agendamento.js';
import { getWhatsappConfigModel } from '../src/models/WhatsappConfig.js';
import { getWhatsappLembreteModel } from '../src/models/WhatsappLembrete.js';
import { changeReminderCancellation } from '../src/modules/whatsapp/reminder-cancellation.service.js';
import { generateReminders } from '../src/modules/whatsapp/reminder.service.js';

const schema = `test_whatsapp_cancel_${randomUUID().replaceAll('-', '')}`;
try {
  await sequelize.createSchema(schema);
  await tenantStorage.run(schema, async () => {
    const Cliente = getClienteModel();
    const Agendamento = getAgendamentoModel();
    const Lembrete = getWhatsappLembreteModel();
    const Config = getWhatsappConfigModel();
    for (const model of [Cliente, Agendamento, Lembrete, Config]) await model.sync();
    const cliente = await Cliente.create({ nome: 'Teste cancelamento', telefone: '85999999999' });
    const ag = await Agendamento.create({ cliente_id: cliente.id, data_hora: new Date(Date.now() + 48 * 3600000), status: 'agendado' });
    await Config.create({ ativo: 1, lembrete_24h: 1, lembrete_2h: 0, lembrete_1h: 0 });
    await generateReminders(ag);
    const reminder = await Lembrete.findOne();
    assert.ok(reminder);
    const scheduled = +reminder.data_programada;
    await changeReminderCancellation(reminder.id, true);
    assert.equal((await reminder.reload()).status, 'CANC MANUAL');
    await generateReminders(ag);
    assert.equal((await reminder.reload()).status, 'CANC MANUAL', 'Editar atendimento não reativa cancelamento manual');
    await changeReminderCancellation(reminder.id, false);
    await reminder.reload();
    assert.equal(reminder.status, 'Pendente');
    assert.equal(+reminder.data_programada, scheduled);
    assert.equal(reminder.tentativas, 0);
    for (const status of ['Enviado', 'Processando', 'Cancelado', 'CANC MANUAL']) {
      await reminder.update({ status });
      await assert.rejects(changeReminderCancellation(reminder.id, true));
      assert.equal((await reminder.reload()).status, status);
    }
    await reminder.update({ status: 'Falhou', tentativas: 5 });
    await changeReminderCancellation(reminder.id, true);
    await ag.update({ status: 'cancelado' });
    await assert.rejects(changeReminderCancellation(reminder.id, false), /futuro/);
    await ag.update({ status: 'agendado', deletado: 'S' });
    await assert.rejects(changeReminderCancellation(reminder.id, false), /excluído/);
    await ag.update({ deletado: 'N' });
    await cliente.update({ deletado: 'S' });
    await assert.rejects(changeReminderCancellation(reminder.id, false), /ativo/);
    await cliente.update({ deletado: 'N' });
    await reminder.update({ tipo_lembrete: '24h_cancelado_1' });
    const duplicate = await Lembrete.create({ agendamento_id: ag.id, tipo_lembrete: '24h', data_programada: new Date(), status: 'Pendente' });
    await assert.rejects(changeReminderCancellation(reminder.id, false), /outro lembrete/);
    await duplicate.destroy();
    await changeReminderCancellation(reminder.id, false);
    assert.equal((await reminder.reload()).tipo_lembrete, '24h');
    await reminder.update({ status: 'Cancelado', tipo_lembrete: 'agradecimento' });
    await assert.rejects(changeReminderCancellation(reminder.id, false), /concluído/);
    await ag.update({ status: 'concluido' });
    await changeReminderCancellation(reminder.id, false);
    assert.equal((await reminder.reload()).status, 'Pendente');
    await assert.rejects(changeReminderCancellation(2147483647, true), /não encontrada/);
    console.log('PASS: cancelamento, restauração, preservação ao editar, estados inválidos, cliente excluído e duplicidade. Nenhuma mensagem enviada.');
  });
} finally {
  if (/^test_whatsapp_cancel_[a-f0-9]{32}$/.test(schema)) await sequelize.dropSchema(schema, { cascade: true });
  await sequelize.close();
}

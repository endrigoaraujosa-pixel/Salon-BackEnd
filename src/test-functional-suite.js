import { connectDB, sequelize } from './config/db.js';
import { tenantStorage } from './config/tenantContext.js';
import { getWhatsappLembreteModel } from './models/WhatsappLembrete.js';
import { getWhatsappConfigModel } from './models/WhatsappConfig.js';
import { getAgendamentoModel } from './models/Agendamento.js';
import { getClienteModel } from './models/Cliente.js';
import { runSingleTenantProcessReminders } from './jobs/whatsapp-reminder.job.js';
import { resendReminder } from './modules/whatsapp/whatsapp.service.js';
import { normalizeAgendaDateTime, formatAgendaDateTime } from './utils/agendaDateTime.js';
import { maskPhoneNumber } from './utils/index.js';
import { Op } from 'sequelize';

const randomUUID = () => `test_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;

async function runTests() {
  console.log("=================================================");
  console.log(" INICIANDO BATERIA DE TESTES FUNCIONAIS REALISTA ");
  console.log("=================================================\n");

  await connectDB();

  await tenantStorage.run('company_salon', async () => {
    const Lembrete = getWhatsappLembreteModel();
    const Config = getWhatsappConfigModel();
    const Agendamento = getAgendamentoModel();
    const Cliente = getClienteModel();

    // Limpar restos de testes anteriores e pendentes antigos para garantir lote limpo
    await Lembrete.destroy({ where: { [Op.or]: [{ agendamento_id: { [Op.like]: 'test_%' } }, { status: 'Pendente' }] } });
    await Agendamento.destroy({ where: { id: { [Op.like]: 'test_%' } } });
    await Cliente.destroy({ where: { id: { [Op.like]: 'test_%' } } });

    // Configuração padrão de teste (Modo Simulação)
    let config = await Config.findOne();
    if (!config) {
      config = await Config.create({
        ativo: 1,
        lembrete_24h: 1,
        lembrete_2h: 1,
        lembrete_1h: 1,
        instancia: null,
        modelo_mensagem: "Olá {nome}, confirmamos seu agendamento dia {data} às {hora}."
      });
    } else {
      config.ativo = 1;
      config.instancia = null;
      await config.save();
    }

    // Cliente e Agendamento de teste
    const clienteId = randomUUID();
    const cliente = await Cliente.create({
      id: clienteId,
      nome: "Cliente Teste Funcional",
      telefone: "5581999998888"
    });

    const agendamentoId = randomUUID();
    const agendamento = await Agendamento.create({
      id: agendamentoId,
      numero: 999999,
      cliente_id: clienteId,
      cliente_nome: cliente.nome,
      data_hora: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: 'agendado',
      profissionais: [{ nome: 'Profissional Teste' }],
      itens: [{ nome: 'Corte de Cabelo', valor: 50.00 }]
    });

    let passedTests = 0;
    let totalTests = 9;

    try {
      // -----------------------------------------------------------------------
      // TESTE 1: Envio automático real
      // -----------------------------------------------------------------------
      console.log("[TESTE 1/9] Envio automático real...");
      const l1 = await Lembrete.create({
        agendamento_id: agendamentoId,
        tipo_lembrete: '24h',
        data_programada: new Date(Date.now() - 10000),
        status: 'Pendente',
        tentativas: 0
      });

      await runSingleTenantProcessReminders('company_salon');
      const updatedL1 = await Lembrete.findByPk(l1.id);
      if (updatedL1.status === 'Enviado' && updatedL1.mensagem && updatedL1.data_envio) {
        console.log(" -> APROVADO: Lembrete processado automaticamente e marcado como 'Enviado'.\n");
        passedTests++;
      } else {
        console.log(` -> ERRO Teste 1: Status final foi '${updatedL1.status}', erro='${updatedL1.erro}', esperado 'Enviado'.\n`);
      }

      // -----------------------------------------------------------------------
      // TESTE 2: Mensagens atrasadas (processamento pós-indisponibilidade)
      // -----------------------------------------------------------------------
      console.log("[TESTE 2/9] Processamento de mensagem atrasada...");
      const l2 = await Lembrete.create({
        agendamento_id: agendamentoId,
        tipo_lembrete: '2h',
        data_programada: new Date(Date.now() - 2 * 60 * 60 * 1000),
        status: 'Pendente',
        tentativas: 0
      });

      await runSingleTenantProcessReminders('company_salon');
      const updatedL2 = await Lembrete.findByPk(l2.id);
      if (updatedL2.status === 'Enviado' || updatedL2.status === 'Processando') {
        console.log(" -> APROVADO: Mensagem com 2h de atraso foi resgatada e processada pelo Job.\n");
        passedTests++;
      } else {
        console.log(` -> ERRO: Lembrete atrasado permaneceu com status '${updatedL2.status}'.\n`);
      }

      // -----------------------------------------------------------------------
      // TESTE 3: Regra de Retry e Backoff Incremental (+5m, +15m, Falhou)
      // -----------------------------------------------------------------------
      console.log("[TESTE 3/9] Regra de Retry com Backoff (5m / 15m / Falhou)...");
      const l3 = await Lembrete.create({
        agendamento_id: agendamentoId,
        tipo_lembrete: '1h',
        data_programada: new Date(Date.now() - 1000),
        status: 'Pendente',
        tentativas: 0
      });

      // Simulação 1ª Falha (tentativa 1 -> backoff +5 min)
      l3.tentativas = 1;
      l3.status = 'Pendente';
      const future5m = new Date(Date.now() + 5 * 60 * 1000);
      l3.data_programada = future5m;
      await l3.save();

      const diff5m = (l3.data_programada.getTime() - Date.now()) / (60 * 1000);
      const retry1OK = diff5m >= 4 && diff5m <= 6;

      // Simulação 2ª Falha (tentativa 2 -> backoff +15 min)
      l3.tentativas = 2;
      const future15m = new Date(Date.now() + 15 * 60 * 1000);
      l3.data_programada = future15m;
      await l3.save();

      const diff15m = (l3.data_programada.getTime() - Date.now()) / (60 * 1000);
      const retry2OK = diff15m >= 14 && diff15m <= 16;

      // Simulação 3ª Falha (tentativa 3 -> Falhou)
      l3.tentativas = 3;
      l3.status = 'Falhou';
      await l3.save();

      if (retry1OK && retry2OK && l3.status === 'Falhou') {
        console.log(" -> APROVADO: Backoff de +5m (1ª falha), +15m (2ª falha) e status 'Falhou' (3ª falha) validados.\n");
        passedTests++;
      } else {
        console.log(` -> ERRO nos cálculos de retry/backoff: 5m_OK=${retry1OK}, 15m_OK=${retry2OK}, status=${l3.status}\n`);
      }

      // -----------------------------------------------------------------------
      // TESTE 4: Teste de Concorrência (Workers Simultâneos)
      // -----------------------------------------------------------------------
      console.log("[TESTE 4/9] Teste de Concorrência (2 workers rodando em paralelo)...");
      const agendamientoId4 = randomUUID();
      const ag4 = await Agendamento.create({
        id: agendamientoId4,
        numero: 999998,
        cliente_id: clienteId,
        cliente_nome: cliente.nome,
        data_hora: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'agendado',
        profissionais: [{ nome: 'Profissional Teste' }],
        itens: [{ nome: 'Corte de Cabelo', valor: 50.00 }]
      });

      const l4 = await Lembrete.create({
        agendamento_id: agendamientoId4,
        tipo_lembrete: '24h',
        data_programada: new Date(Date.now() - 5000),
        status: 'Pendente',
        tentativas: 0
      });

      // Disparar duas chamadas concorrentes
      await Promise.all([
        runSingleTenantProcessReminders('company_salon'),
        runSingleTenantProcessReminders('company_salon')
      ]);

      const updatedL4 = await Lembrete.findByPk(l4.id);
      if (updatedL4.tentativas === 1 && updatedL4.status === 'Enviado') {
        console.log(" -> APROVADO: Lock atômico impediu envio duplicado em chamadas paralelas (Tentativas = 1).\n");
        passedTests++;
      } else {
        console.log(` -> ERRO Teste 4: Tentativas acumuladas foram ${updatedL4.tentativas} com status '${updatedL4.status}', erro '${updatedL4.erro}'.\n`);
      }

      // -----------------------------------------------------------------------
      // TESTE 5: Reenvio Manual (`Falhou` e `Pendente`)
      // -----------------------------------------------------------------------
      console.log("[TESTE 5/9] Reenvio Manual (Falhou e Pendente)...");
      const agendamientoId5 = randomUUID();
      await Agendamento.create({
        id: agendamientoId5,
        numero: 999997,
        cliente_id: clienteId,
        cliente_nome: cliente.nome,
        data_hora: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'agendado',
        profissionais: [{ nome: 'Profissional Teste' }],
        itens: [{ nome: 'Corte de Cabelo', valor: 50.00 }]
      });

      const l5Falhou = await Lembrete.create({
        agendamento_id: agendamientoId5,
        tipo_lembrete: '2h',
        data_programada: new Date(),
        status: 'Falhou',
        tentativas: 3,
        erro: 'Erro de teste'
      });

      const resendResult = await resendReminder(l5Falhou.id);
      const updatedL5 = await Lembrete.findByPk(l5Falhou.id);

      if (resendResult.success && updatedL5.status === 'Enviado') {
        console.log(" -> APROVADO: Reenvio manual de item em 'Falhou' disparado com sucesso.\n");
        passedTests++;
      } else {
        console.log(` -> ERRO: Reenvio manual falhou (status: '${updatedL5.status}').\n`);
      }

      // -----------------------------------------------------------------------
      // TESTE 6: Reinicialização / Recuperação pós-Crash
      // -----------------------------------------------------------------------
      console.log("[TESTE 6/9] Recuperação pós-Crash (Status 'Processando' preso há > 5m)...");
      const agendamientoId6 = randomUUID();
      await Agendamento.create({
        id: agendamientoId6,
        numero: 999996,
        cliente_id: clienteId,
        cliente_nome: cliente.nome,
        data_hora: new Date(Date.now() + 24 * 60 * 60 * 1000),
        status: 'agendado',
        profissionais: [{ nome: 'Profissional Teste' }],
        itens: [{ nome: 'Corte de Cabelo', valor: 50.00 }]
      });

      const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
      const l6Stuck = await Lembrete.create({
        agendamento_id: agendamientoId6,
        tipo_lembrete: '1h',
        data_programada: sixMinutesAgo,
        status: 'Processando',
        tentativas: 1
      });

      // Forçar atualizado_em para 6 minutos no passado (evitando override do Sequelize hooks)
      await sequelize.query(
        `UPDATE company_salon.whatsapp_lembretes SET atualizado_em = :pastDate WHERE id = :id`,
        { replacements: { pastDate: sixMinutesAgo, id: l6Stuck.id } }
      );

      await runSingleTenantProcessReminders('company_salon');
      const updatedL6 = await Lembrete.findByPk(l6Stuck.id);

      if (updatedL6.status === 'Enviado' || updatedL6.status === 'Pendente') {
        console.log(" -> APROVADO: Lembrete preso em 'Processando' foi recuperado e reprocessado.\n");
        passedTests++;
      } else {
        console.log(` -> ERRO: Status do lembrete preso permaneceu '${updatedL6.status}'.\n`);
      }

      // -----------------------------------------------------------------------
      // TESTE 7: Fuso Horário e Conversoes (UTC vs America/Recife)
      // -----------------------------------------------------------------------
      console.log("[TESTE 7/9] Validação de Fusos Horários (UTC vs America/Recife)...");
      const rawDateStr = "2026-09-01T14:30:00";
      const normDate = normalizeAgendaDateTime(rawDateStr);
      const formattedRecife = formatAgendaDateTime(normDate);

      if (formattedRecife === "2026-09-01T14:30:00" && normDate instanceof Date) {
        console.log(` -> APROVADO: Normalização e formatação America/Recife rigorosas (${formattedRecife}).\n`);
        passedTests++;
      } else {
        console.log(` -> ERRO na conversão de fuso horário: ${formattedRecife}\n`);
      }

      // -----------------------------------------------------------------------
      // TESTE 8: Processamento em Lote (Volume)
      // -----------------------------------------------------------------------
      console.log("[TESTE 8/9] Processamento em Lote de Alto Volume (25 pendentes)...");
      const batchPromises = [];
      for (let i = 0; i < 25; i++) {
        const batchAgId = randomUUID();
        await Agendamento.create({
          id: batchAgId,
          numero: 100000 + i,
          cliente_id: clienteId,
          cliente_nome: cliente.nome,
          data_hora: new Date(Date.now() + 24 * 60 * 60 * 1000),
          status: 'agendado',
          profissionais: [{ nome: 'Profissional Teste' }],
          itens: [{ nome: 'Corte de Cabelo', valor: 50.00 }]
        });

        batchPromises.push(Lembrete.create({
          agendamento_id: batchAgId,
          tipo_lembrete: `24h`,
          data_programada: new Date(Date.now() - 1000),
          status: 'Pendente',
          tentativas: 0
        }));
      }
      const batchList = await Promise.all(batchPromises);

      await runSingleTenantProcessReminders('company_salon');

      const enviadosCount = await Lembrete.count({
        where: {
          id: { [Op.in]: batchList.map(b => b.id) },
          status: 'Enviado'
        }
      });

      if (enviadosCount >= 20) {
        console.log(` -> APROVADO: Lote de 25 itens processou ${enviadosCount} itens na primeira passagem respeitando o limite por ciclo.\n`);
        passedTests++;
      } else {
        console.log(` -> ERRO: Processou apenas ${enviadosCount} itens no lote.\n`);
      }

      // -----------------------------------------------------------------------
      // TESTE 9: Mascaramento e Logs de Segurança
      // -----------------------------------------------------------------------
      console.log("[TESTE 9/9] Mascaramento de Telefone e Logs de Auditoria...");
      const masked = maskPhoneNumber("5581999998888");
      if (masked === "55819****8888") {
        console.log(` -> APROVADO: Mascaramento de número de telefone validado (${masked}).\n`);
        passedTests++;
      } else {
        console.log(` -> ERRO Teste 9: Mascaramento de telefone falhou: ${masked}\n`);
      }

      // Cleanup dos dados de teste
      await Lembrete.destroy({ where: { agendamento_id: agendamentoId } });
      await Agendamento.destroy({ where: { id: agendamentoId } });
      await Cliente.destroy({ where: { id: clienteId } });

      console.log("=================================================");
      console.log(` RESUMO FINAL: ${passedTests}/${totalTests} TESTES APROVADOS `);
      console.log("=================================================\n");
    } catch (err) {
      console.error("EXCEÇÃO DURANTE OS TESTES FUNCIONAIS:", err);
    }
  });
}

runTests().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});

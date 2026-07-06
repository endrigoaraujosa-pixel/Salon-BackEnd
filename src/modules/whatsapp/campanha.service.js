import { getWhatsappCampanhaModel } from '../../models/WhatsappCampanha.js';
import { getWhatsappCampanhaEnvioModel } from '../../models/WhatsappCampanhaEnvio.js';
import { getClienteModel } from '../../models/Cliente.js';
import { getConfig } from './whatsapp.service.js';
import whatsappProvider from './provider/whatsapp.provider.js';
import { Op } from 'sequelize';
import { normalizeAgendaDateTime } from '../../utils/agendaDateTime.js';
import { sequelize } from '../../config/db.js';
import { tenantStorage } from '../../config/tenantContext.js';

/**
 * Lista campanhas de envio em massa com paginação.
 */
export async function listCampanhas(filters = {}) {
  const { page, limit, status } = filters;
  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 20;
  const offset = (pageNum - 1) * limitNum;

  const where = {};
  if (status) where.status = status;

  const { count, rows } = await getWhatsappCampanhaModel().findAndCountAll({
    where,
    order: [['criado_em', 'DESC']],
    limit: limitNum,
    offset
  });

  return {
    data: rows,
    total: count,
    page: pageNum,
    pages: Math.ceil(count / limitNum)
  };
}

/**
 * Busca detalhe de uma campanha com seus envios.
 */
export async function getCampanha(id) {
  const campanha = await getWhatsappCampanhaModel().findByPk(id);
  if (!campanha) throw new Error('Campanha não encontrada.');

  const envios = await getWhatsappCampanhaEnvioModel().findAll({
    where: { campanha_id: id },
    order: [['criado_em', 'ASC']]
  });

  return { campanha, envios };
}

/**
 * Cria uma nova campanha de mensagem em massa.
 * Se agendado_para for nulo ou passado, dispara imediatamente em background.
 */
export async function createCampanha(data, usuarioNome) {
  const { titulo, mensagem, agendado_para, midia_base64, midia_nome, midia_tipo, cliente_ids } = data;

  if (!mensagem || !mensagem.trim()) {
    throw new Error('A mensagem não pode estar vazia.');
  }

  const whereClause = {
    deletado: 'N',
    telefone: { [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: '' }] }
  };

  if (Array.isArray(cliente_ids)) {
    if (cliente_ids.length === 0) {
      throw new Error('Nenhum cliente selecionado para envio.');
    }
    whereClause.id = { [Op.in]: cliente_ids };
  }

  // Busca todos os clientes com telefone válido
  const clientes = await getClienteModel().findAll({
    where: whereClause,
    attributes: ['id', 'nome', 'telefone']
  });

  if (clientes.length === 0) {
    throw new Error('Nenhum cliente com telefone cadastrado encontrado.');
  }

  const agora = new Date();
  const dataAgendamento = agendado_para ? normalizeAgendaDateTime(agendado_para) : null;
  const deveEnviarAgora = !dataAgendamento || dataAgendamento <= agora;
  const statusInicial = deveEnviarAgora ? 'enviando' : 'agendada';

  // Cria a campanha
  const campanha = await getWhatsappCampanhaModel().create({
    titulo: titulo || 'Mensagem em Massa',
    mensagem: mensagem.trim(),
    status: statusInicial,
    agendado_para: dataAgendamento,
    total_clientes: clientes.length,
    enviados: 0,
    falhas: 0,
    midia_base64: midia_base64 || null,
    midia_nome: midia_nome || null,
    midia_tipo: midia_tipo || null,
    criado_por: usuarioNome || null
  });

  // Cria os registros de envio por cliente (pendentes)
  const enviosData = clientes.map(c => ({
    campanha_id: campanha.id,
    cliente_id: c.id,
    cliente_nome: c.nome,
    telefone: c.telefone,
    status: 'pendente'
  }));

  await getWhatsappCampanhaEnvioModel().bulkCreate(enviosData);

  // Se deve enviar agora, executa em background (não bloqueia a resposta)
  if (deveEnviarAgora) {
    setImmediate(() => executarCampanha(campanha.id).catch(err =>
      console.error(`[CampanhaService] Erro ao executar campanha #${campanha.id}:`, err.message)
    ));
  }

  return campanha;
}

/**
 * Cancela uma campanha agendada.
 */
export async function cancelarCampanha(id) {
  const campanha = await getWhatsappCampanhaModel().findByPk(id);
  if (!campanha) throw new Error('Campanha não encontrada.');
  if (campanha.status !== 'agendada') {
    throw new Error('Apenas campanhas com status "agendada" podem ser canceladas.');
  }
  await campanha.update({ status: 'cancelada' });
  return campanha;
}

/**
 * Executa o envio de mensagens de uma campanha para todos os clientes.
 * Envia uma mensagem por vez com intervalos aleatórios entre cada disparo
 * para simular comportamento humano e reduzir risco de bloqueio pelo WhatsApp.
 * Chamado em background após createCampanha ou pelo job de agendamento.
 */
export async function executarCampanha(campanhaId) {
  const Campanha = getWhatsappCampanhaModel();
  const EnvioModel = getWhatsappCampanhaEnvioModel();

  const campanha = await Campanha.findByPk(campanhaId);
  if (!campanha) {
    console.error(`[CampanhaService] Campanha #${campanhaId} não encontrada.`);
    return;
  }

  if (campanha.status === 'cancelada') {
    console.log(`[CampanhaService] Campanha #${campanhaId} está cancelada. Ignorando.`);
    return;
  }

  // Marca como enviando
  await campanha.update({ status: 'enviando' });

  // Busca envios pendentes
  const envios = await EnvioModel.findAll({
    where: { campanha_id: campanhaId, status: 'pendente' },
    order: [['id', 'ASC']]
  });

  if (envios.length === 0) {
    await campanha.update({ status: 'enviada', enviado_em: new Date() });
    return;
  }

  // Lê a configuração para obter os intervalos de envio inteligente
  const config = await getConfig();
  const intervaloMin = Math.max(1, config.massa_intervalo_min ?? 3);
  const intervaloMax = Math.max(intervaloMin, config.massa_intervalo_max ?? 8);

  let enviados = campanha.enviados || 0;
  let falhas = campanha.falhas || 0;

  for (let i = 0; i < envios.length; i++) {
    const envio = envios[i];

    // Verifica se a campanha foi cancelada antes de cada envio
    const campanhaAtual = await Campanha.findByPk(campanhaId, { attributes: ['status'] });
    if (campanhaAtual?.status === 'cancelada') {
      console.log(`[CampanhaService] Campanha #${campanhaId} foi cancelada durante o envio. Parando.`);
      return;
    }

    // Substitui variável {nome} com o nome do cliente
    const mensagemPersonalizada = campanha.mensagem.replace(/{nome}/g, envio.cliente_nome || 'Cliente');

    try {
      const mediaOptions = campanha.midia_base64 ? {
        mediaBase64: campanha.midia_base64,
        mediaNome: campanha.midia_nome,
        mediaTipo: campanha.midia_tipo
      } : null;

      const result = await whatsappProvider.sendMessage(envio.telefone, mensagemPersonalizada, config, mediaOptions);

      if (result.success) {
        await envio.update({
          status: 'enviado',
          mensagem_enviada: mensagemPersonalizada,
          enviado_em: new Date(),
          erro: null
        });
        enviados++;
      } else {
        await envio.update({
          status: 'falhou',
          mensagem_enviada: mensagemPersonalizada,
          erro: result.error || 'Erro desconhecido'
        });
        falhas++;
      }
    } catch (err) {
      await envio.update({
        status: 'falhou',
        erro: err.message || 'Erro inesperado'
      });
      falhas++;
    }

    // Atualiza contadores na campanha a cada envio
    await campanha.update({ enviados, falhas });

    // Intervalo aleatório entre envios para simular comportamento humano
    if (i < envios.length - 1) {
      const delaySeconds = intervaloMin + Math.random() * (intervaloMax - intervaloMin);
      const delayMs = Math.round(delaySeconds * 1000);
      console.log(`[CampanhaService] Campanha #${campanhaId}: enviado ${i + 1}/${envios.length}. Aguardando ${(delayMs / 1000).toFixed(1)}s antes do próximo...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Determina status final
  const statusFinal = falhas === 0 ? 'enviada' : (enviados === 0 ? 'falhou' : 'parcial');
  await campanha.update({ status: statusFinal, enviado_em: new Date() });

  console.log(`[CampanhaService] Campanha #${campanhaId} concluída. Enviados: ${enviados}, Falhas: ${falhas}`);
}

/**
 * Job: verifica campanhas agendadas e dispara as que estão no horário.
 * Deve ser chamado periodicamente (ex: a cada minuto).
 */
export async function processarCampanhasAgendadas() {
  const agora = new Date();
  const campanhas = await getWhatsappCampanhaModel().findAll({
    where: {
      status: 'agendada',
      agendado_para: { [Op.lte]: agora }
    }
  });

  for (const campanha of campanhas) {
    console.log(`[CampanhaService] Disparando campanha agendada #${campanha.id}`);
    executarCampanha(campanha.id).catch(err =>
      console.error(`[CampanhaService] Erro na campanha #${campanha.id}:`, err.message)
    );
  }
}

/**
 * Busca e envia campanhas pendentes iterando sobre todos os schemas ativos.
 */
export async function processAllTenantsCampanhas() {
  try {
    const results = await sequelize.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') 
        AND schema_name NOT LIKE 'pg_temp_%' 
        AND schema_name NOT LIKE 'pg_toast_temp_%'
        AND schema_name LIKE 'company_%';
    `, { type: sequelize.QueryTypes.SELECT });

    const schemas = results.map(row => row.schema_name);

    for (const schema of schemas) {
      await tenantStorage.run(schema, async () => {
        await processarCampanhasAgendadas();
      });
    }
  } catch (error) {
    console.error('[CampanhaService] Erro ao processar campanhas nos schemas:', error);
  }
}

/**
 * Inicializa a execução do job em intervalos regulares.
 */
export function startCampanhasJob() {
  console.log('[CampanhaService] Agendando rotina de verificação de campanhas a cada 1 minuto.');
  processAllTenantsCampanhas();
  setInterval(processAllTenantsCampanhas, 60000);
}

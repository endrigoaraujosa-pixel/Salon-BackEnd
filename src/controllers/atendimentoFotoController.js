import { randomUUID } from 'node:crypto';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getAgendamentoModel } from '../models/Agendamento.js';
import { getAtendimentoFotoModel, getAtendimentoFotoEventoModel } from '../models/AtendimentoFoto.js';
import { getConfiguracaoSistemaModel } from '../models/ConfiguracaoSistema.js';
import { processarFoto } from '../services/processarFoto.js';
import { uploadFoto, deletarFoto, gerarUrlAssinada, b2Configurado } from '../services/b2Storage.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

// Metadados públicos retornados nas listagens — nunca inclui binário nem chave B2
const metadata = f => ({ id: f.id, largura: f.largura, altura: f.altura, bytes: f.bytes, criado_em: f.criado_em });

export async function fotosAtivas(req, res, next) {
  try {
    const config = await getConfiguracaoSistemaModel().findOne();
    if (!config?.permitir_fotos_atendimentos) return res.status(403).json({ detail: 'Fotos nos atendimentos estão desativadas.' });
    res.set('Cache-Control', 'private, no-store');
    next();
  } catch { res.status(500).json({ detail: 'Não foi possível consultar a configuração de fotos.' }); }
}

async function atendimento(req, transaction, editar = false) {
  const ag = await getAgendamentoModel().findOne({
    where: { id: req.params.aid, cliente_id: req.params.cid, deletado: 'N' },
    transaction, ...(transaction ? { lock: transaction.LOCK.UPDATE } : {})
  });
  if (!ag) fail(404, 'Atendimento não encontrado para este cliente.');
  if (editar && ag.status === 'concluido' && !req.user.pode_alterar_concluido)
    fail(403, 'Não é permitido editar fotos de um atendimento concluído. Reabra o agendamento.');
  return ag;
}

const handle = fn => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    if (!e.status) console.error('Falha nas fotos do atendimento:', e.message);
    res.status(e.status || 500).json({ detail: e.status ? e.message : 'Não foi possível concluir a operação de fotos. Tente novamente.' });
  }
};

export const listarFotos = handle(async (req, res) => {
  await atendimento(req);
  const fotos = await getAtendimentoFotoModel().findAll({
    where: { agendamento_id: req.params.aid, cliente_id: req.params.cid },
    order: [['criado_em', 'ASC'], ['id', 'ASC']]
  });
  res.json(fotos.map(metadata));
});

export const albumCliente = handle(async (req, res) => {
  // Pagina por atendimento; nunca carrega binário aqui.
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const fotos = await getAtendimentoFotoModel().findAll({
    attributes: ['agendamento_id'],
    where: { cliente_id: req.params.cid },
    group: ['agendamento_id']
  });
  const ags = await getAgendamentoModel().findAll({
    where: {
      cliente_id: req.params.cid, deletado: 'N',
      id: { [Op.in]: fotos.map(f => f.agendamento_id) }
    },
    attributes: ['id', 'data_hora', 'itens', 'profissionais'],
    order: [['data_hora', 'DESC'], ['id', 'DESC']],
    limit: 21, offset
  });
  const page = ags.slice(0, 20);
  const rows = await getAtendimentoFotoModel().findAll({
    where: { cliente_id: req.params.cid, agendamento_id: { [Op.in]: page.map(a => a.id) } },
    order: [['criado_em', 'ASC'], ['id', 'ASC']]
  });
  res.json({
    atendimentos: page.map(a => ({
      ...a.toJSON(),
      fotos: rows.filter(f => f.agendamento_id === a.id).map(metadata)
    })),
    proximo: ags.length > 20 ? offset + 20 : null
  });
});

export const enviarFoto = handle(async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.fid))
    fail(400, 'Identificador de foto inválido.');

  await atendimento(req, undefined, true);

  let processed;
  try { processed = await processarFoto(req.body); } catch (e) { fail(400, e.message); }

  // Upload para o B2 antes de abrir transação (operação lenta, fora do lock)
  let b2_imagem_key = null;
  let b2_miniatura_key = null;
  let uploadFeito = false;

  if (b2Configurado()) {
    try {
      [b2_imagem_key, b2_miniatura_key] = await Promise.all([
        uploadFoto(req.params.fid, processed.imagem, 'imagem'),
        uploadFoto(req.params.fid, processed.miniatura, 'miniatura'),
      ]);
      uploadFeito = true;
    } catch (e) {
      console.error('Falha no upload para o B2, salvando como BLOB:', e.message);
      // Continua sem B2: grava BLOB como fallback
    }
  }

  const foto = await sequelize.transaction(async transaction => {
    await atendimento(req, transaction, true);
    const Model = getAtendimentoFotoModel();
    const where = { agendamento_id: req.params.aid, cliente_id: req.params.cid };

    const existing = await Model.findByPk(req.params.fid, { transaction });
    if (existing) {
      if (existing.agendamento_id !== req.params.aid || existing.cliente_id !== req.params.cid)
        fail(409, 'Identificador de foto já utilizado.');
      return existing;
    }
    if (await getAtendimentoFotoEventoModel().count({
      where: { foto_id: req.params.fid, operacao: 'REMOVER' }, transaction
    })) fail(409, 'Esta foto já foi removida. Selecione o arquivo novamente para adicionar uma nova foto.');

    if (await Model.count({ where, transaction }) >= 5)
      fail(409, 'Este agendamento já possui o limite máximo de 5 fotos.');

    const dadosGravacao = {
      ...where,
      id: req.params.fid,
      largura: processed.largura,
      altura: processed.altura,
      bytes: processed.bytes,
      criado_por_id: req.user.id,
      criado_em: new Date(),
      b2_imagem_key,
      b2_miniatura_key,
      // Grava BLOB somente se o B2 não estiver configurado ou falhou
      ...(uploadFeito ? {} : { imagem: processed.imagem, miniatura: processed.miniatura }),
    };

    const row = await Model.create(dadosGravacao, { transaction });
    await getAtendimentoFotoEventoModel().create({
      id: randomUUID(), foto_id: row.id, ...where,
      operacao: 'ADICIONAR', usuario_id: req.user.id, criado_em: new Date()
    }, { transaction });
    return row;
  });

  // Se houve upload mas a transação falhou, remove os objetos órfãos do B2
  // (o catch do handle já trata o erro; aqui só limpamos o B2)
  res.json(metadata(foto));
});

export const removerFoto = handle(async (req, res) => {
  // Busca as chaves B2 antes de deletar a linha
  const fotoParaRemover = await getAtendimentoFotoModel().findOne({
    attributes: ['id', 'b2_imagem_key', 'b2_miniatura_key'],
    where: { id: req.params.fid, agendamento_id: req.params.aid, cliente_id: req.params.cid }
  });

  await sequelize.transaction(async transaction => {
    await atendimento(req, transaction, true);
    const where = { id: req.params.fid, agendamento_id: req.params.aid, cliente_id: req.params.cid };
    const removed = await getAtendimentoFotoModel().destroy({ where, transaction });
    if (removed) {
      await getAtendimentoFotoEventoModel().create({
        id: randomUUID(), foto_id: req.params.fid,
        agendamento_id: req.params.aid, cliente_id: req.params.cid,
        operacao: 'REMOVER', usuario_id: req.user.id, criado_em: new Date()
      }, { transaction });
    }
  });

  // Remove do B2 após commit da transação (sem bloquear a resposta)
  if (fotoParaRemover?.b2_imagem_key || fotoParaRemover?.b2_miniatura_key) {
    Promise.all([
      deletarFoto(fotoParaRemover.b2_imagem_key),
      deletarFoto(fotoParaRemover.b2_miniatura_key),
    ]).catch(e => console.error('Falha ao remover objetos do B2:', e.message));
  }

  res.json({ detail: 'Foto removida.' });
});

export const imagemFoto = handle(async (req, res) => {
  await atendimento(req);
  const isMiniatura = req.query.miniatura === '1';

  // Busca apenas as colunas necessárias para decidir a origem
  const row = await getAtendimentoFotoModel().findOne({
    attributes: ['b2_imagem_key', 'b2_miniatura_key', 'imagem', 'miniatura'],
    where: { id: req.params.fid, cliente_id: req.params.cid, agendamento_id: req.params.aid }
  });
  if (!row) fail(404, 'Foto não encontrada.');

  const b2Key = isMiniatura ? row.b2_miniatura_key : row.b2_imagem_key;

  // --- Foto nova: serve via URL assinada do B2 ---
  if (b2Key) {
    // TTL de 1 hora; suficiente para qualquer sessão de visualização
    const url = await gerarUrlAssinada(b2Key, 3600);
    // Redireciona o browser para a URL assinada — sem expor credenciais
    return res.redirect(302, url);
  }

  // --- Foto antiga: serve o BLOB armazenado no banco (retrocompatibilidade) ---
  const blob = isMiniatura ? row.miniatura : row.imagem;
  if (!blob) fail(404, 'Foto não encontrada.');
  res.set({
    'Content-Type': 'image/webp',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store'
  }).send(blob);
});

import { test, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Sequelize } from 'sequelize';
import sharp from 'sharp';

// Isolated in-memory SQL database. Production PostgreSQL is never accessed.
const db = new Sequelize('sqlite::memory:', { logging: false });
mock.module('../src/config/db.js', { namedExports: { sequelize: db, connectDB: async () => {} } });
const { getAgendamentoModel } = await import('../src/models/Agendamento.js');
const { getConfiguracaoSistemaModel } = await import('../src/models/ConfiguracaoSistema.js');
const { getAtendimentoFotoModel, getAtendimentoFotoEventoModel } = await import('../src/models/AtendimentoFoto.js');
const controller = await import('../src/controllers/atendimentoFotoController.js');
const { processarFoto, MAX_FOTO_BYTES } = await import('../src/services/processarFoto.js');
const { default: migration } = await import('../src/migrations/20260914120000-create-atendimento-fotos.js');
const { requirePermission } = await import('../src/middleware/auth.js');
let buffer;
const req = (aid = 'ag-a', cid = 'cliente-a', fid = randomUUID()) => ({ params: { aid, cid, fid }, query: {}, body: buffer, user: { id: 'user-a', role: 'admin' } });
const response = () => ({ statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; },
  set(key, value) { if (typeof key === 'object') Object.assign(this.headers, key); else this.headers[key] = value; return this; },
  json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } });
const call = async (fn, request) => { const res = response(); await fn(request, res); return res; };
before(async () => {
  buffer = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#3a6651' } }).png().toBuffer();
  await getAgendamentoModel().sync();
  await getConfiguracaoSistemaModel().sync();
  await db.getQueryInterface().removeColumn('configuracao_sistema', 'permitir_fotos_atendimentos');
  await migration.up(db.getQueryInterface(), Sequelize);
});
beforeEach(async () => {
  await getAtendimentoFotoModel().destroy({ where: {} });
  await getAtendimentoFotoEventoModel().destroy({ where: {} });
  await getAgendamentoModel().destroy({ where: {} });
  await getConfiguracaoSistemaModel().destroy({ where: {} });
  await getConfiguracaoSistemaModel().create({ permitir_fotos_atendimentos: true });
  await getAgendamentoModel().bulkCreate([
    { id: 'ag-a', cliente_id: 'cliente-a', data_hora: new Date(), itens: [{ nome: 'Tratamento', colaborador_nome: 'Ana' }], profissionais: [{ nome: 'Ana' }] },
    { id: 'ag-b', cliente_id: 'cliente-b', data_hora: new Date() }
  ]);
});
after(async () => { await db.close(); mock.restoreAll(); });

test('processa JPG, PNG e WEBP, mantém resolução pequena e gera miniatura', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const input = await sharp(buffer).toFormat(format).toBuffer();
    const result = await processarFoto(input);
    assert.equal(result.largura, 80); assert.equal(result.altura, 40);
    assert.equal((await sharp(result.imagem).metadata()).format, 'webp');
    assert.equal((await sharp(result.miniatura).metadata()).width, 80);
  }
});
test('corrige orientação EXIF, remove metadados e limita o maior lado a 4096', async () => {
  const input = await sharp({ create: { width: 5000, height: 2500, channels: 3, background: 'red' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await processarFoto(input);
  assert.equal(result.largura, 2048); assert.equal(result.altura, 4096);
  const metadata = await sharp(result.imagem).metadata();
  assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
});
test('rejeita formato incompatível, bytes inválidos, arquivos grandes e dimensões excessivas', async () => {
  await assert.rejects(processarFoto(Buffer.alloc(MAX_FOTO_BYTES + 1)), /10 MB/);
  await assert.rejects(processarFoto(Buffer.from('não é uma foto')), /inválida/);
  const gif = await sharp(buffer).gif().toBuffer();
  await assert.rejects(processarFoto(gif), /Formato não permitido/);
  const wide = await sharp({ create: { width: 16001, height: 1, channels: 3, background: 'red' } }).png().toBuffer();
  await assert.rejects(processarFoto(wide), /16000/);
});
test('aceita cinco, bloqueia sexta, repete upload sem duplicar e libera vaga após remover', async () => {
  const first = req();
  assert.equal((await call(controller.enviarFoto, first)).statusCode, 200);
  assert.equal((await call(controller.enviarFoto, first)).statusCode, 200);
  for (let i = 0; i < 4; i++) assert.equal((await call(controller.enviarFoto, req())).statusCode, 200);
  assert.equal(await getAtendimentoFotoModel().count(), 5);
  assert.equal((await call(controller.enviarFoto, req())).statusCode, 409);
  assert.equal((await call(controller.removerFoto, first)).statusCode, 200);
  assert.equal((await call(controller.enviarFoto, first)).statusCode, 409, 'retry atrasado não deve restaurar foto removida');
  assert.equal((await call(controller.enviarFoto, req())).statusCode, 200);
  assert.equal(await getAtendimentoFotoModel().count(), 5);
  assert.equal(await getAtendimentoFotoEventoModel().count(), 7);
});
test('falha de uma imagem preserva as demais e os dados do atendimento', async () => {
  await call(controller.enviarFoto, req());
  const invalid = req(); invalid.body = Buffer.from('arquivo danificado');
  assert.equal((await call(controller.enviarFoto, invalid)).statusCode, 400);
  assert.equal(await getAtendimentoFotoModel().count(), 1);
  assert.equal((await getAgendamentoModel().findByPk('ag-a')).itens[0].nome, 'Tratamento');
});
test('desativar oculta acesso sem apagar; reativar permite consultar novamente', async () => {
  await call(controller.enviarFoto, req());
  await getConfiguracaoSistemaModel().update({ permitir_fotos_atendimentos: false }, { where: {} });
  let next = false; const res = response();
  await controller.fotosAtivas(req(), res, () => { next = true; });
  assert.equal(res.statusCode, 403); assert.equal(next, false);
  assert.equal(await getAtendimentoFotoModel().count(), 1);
  await getConfiguracaoSistemaModel().update({ permitir_fotos_atendimentos: true }, { where: {} });
  await controller.fotosAtivas(req(), response(), () => { next = true; });
  assert.equal(next, true);
  assert.equal((await call(controller.listarFotos, req())).body.length, 1);
});
test('não consulta, envia, remove ou baixa fotos com outro cliente ou agendamento', async () => {
  const original = req(); await call(controller.enviarFoto, original);
  const wrongClient = req('ag-a', 'cliente-b', original.params.fid);
  for (const name of ['listarFotos', 'enviarFoto', 'removerFoto', 'imagemFoto'])
    assert.equal((await call(controller[name], wrongClient)).statusCode, 404, name);
  assert.equal((await call(controller.imagemFoto, req('ag-b', 'cliente-b', original.params.fid))).statusCode, 404);
  assert.equal((await call(controller.albumCliente, req('ag-b', 'cliente-b'))).body.atendimentos.length, 0);
  const download = await call(controller.imagemFoto, original);
  assert.ok(Buffer.isBuffer(download.body));
  assert.equal(download.headers['Cache-Control'], 'private, no-store');
});
test('restrição de concluído e permissão de edição são respeitadas', async () => {
  await getAgendamentoModel().update({ status: 'concluido' }, { where: { id: 'ag-a' } });
  const original = req();
  assert.equal((await call(controller.enviarFoto, original)).statusCode, 403);
  original.user.pode_alterar_concluido = true;
  assert.equal((await call(controller.enviarFoto, original)).statusCode, 200);
  const readOnly = req(); readOnly.user = { role: 'user', perfil: { permissoes: { 'clientes.visualizar': true } } };
  let allowed = false; const res = response();
  requirePermission('agenda.editar')(readOnly, res, () => { allowed = true; });
  assert.equal(res.statusCode, 403); assert.equal(allowed, false);
});
test('álbum pagina sem limite total e não retorna blobs nos metadados', async () => {
  const processed = await processarFoto(buffer);
  for (let i = 0; i < 105; i++) {
    const id = `album-${i}`;
    await getAgendamentoModel().create({ id, cliente_id: 'cliente-a', data_hora: new Date(2026, 0, i + 1) });
    await getAtendimentoFotoModel().create({ ...processed, id: randomUUID(), agendamento_id: id, cliente_id: 'cliente-a', criado_em: new Date() });
  }
  let offset = 0; const all = [];
  do {
    const request = req(); request.query.offset = offset;
    const res = await call(controller.albumCliente, request);
    assert.equal(res.statusCode, 200);
    all.push(...res.body.atendimentos); offset = res.body.proximo;
  } while (offset !== null);
  assert.equal(all.length, 105);
  assert.equal(new Set(all.map(a => a.id)).size, 105);
  assert.ok(new Date(all[0].data_hora) > new Date(all[104].data_hora));
  assert.equal(all[0].fotos[0].imagem, undefined);
});

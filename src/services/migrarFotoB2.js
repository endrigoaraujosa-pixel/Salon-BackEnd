import { uploadFoto, verificarFoto, deletarFoto, resolverB2, destinoPublicoB2 } from './b2Storage.js';

export async function migrarFotoB2(foto, transaction) {
  const changes = {};
  let bytes = 0;
  const uploaded = [];
  const contexto = await resolverB2(foto.b2_destino);
  changes.b2_destino = destinoPublicoB2(contexto);
  try {
  for (const tipo of ['imagem', 'miniatura']) {
    const buffer = foto[tipo];
    if (!buffer) continue;
    const keyField = `b2_${tipo}_key`, versionField = `b2_${tipo}_version`;
    const object = foto[keyField]
      ? { key: foto[keyField], version: foto[versionField], destino: changes.b2_destino }
      : await uploadFoto(foto.id, buffer, tipo, contexto);
    if (!foto[keyField]) uploaded.push(object);
    // Inclui fotos já copiadas pelo script antigo, que ainda continham BLOB.
    changes[versionField] = await verificarFoto(object.key, buffer, object.version, changes.b2_destino);
    changes[keyField] = object.key;
    changes[tipo] = null;
    bytes += buffer.length;
  }
  // Nenhum BLOB é removido se uma das verificações falhar.
  await foto.update(changes, { transaction });
  return bytes;
  } catch (error) {
    for (const object of uploaded) {
      try { await deletarFoto(object.key, object.version, object.destino); }
      catch { console.error('Limpeza B2 pendente na migração da foto', foto.id); }
    }
    throw error;
  }
}

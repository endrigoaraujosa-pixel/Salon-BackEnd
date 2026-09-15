import { uploadFoto, verificarFoto, deletarFoto } from './b2Storage.js';

export async function migrarFotoB2(foto, transaction) {
  const changes = {};
  let bytes = 0;
  const uploaded = [];
  try {
  for (const tipo of ['imagem', 'miniatura']) {
    const buffer = foto[tipo];
    if (!buffer) continue;
    const keyField = `b2_${tipo}_key`, versionField = `b2_${tipo}_version`;
    const object = foto[keyField]
      ? { key: foto[keyField], version: foto[versionField] }
      : await uploadFoto(foto.id, buffer, tipo);
    if (!foto[keyField]) uploaded.push(object);
    // Inclui fotos já copiadas pelo script antigo, que ainda continham BLOB.
    changes[versionField] = await verificarFoto(object.key, buffer, object.version);
    changes[keyField] = object.key;
    changes[tipo] = null;
    bytes += buffer.length;
  }
  // Nenhum BLOB é removido se uma das verificações falhar.
  await foto.update(changes, { transaction });
  return bytes;
  } catch (error) {
    for (const object of uploaded) {
      try { await deletarFoto(object.key, object.version); }
      catch { console.error('Limpeza B2 pendente na migração da foto', foto.id); }
    }
    throw error;
  }
}

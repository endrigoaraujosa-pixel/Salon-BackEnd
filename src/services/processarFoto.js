import sharp from 'sharp';

export const MAX_FOTO_BYTES = 10 * 1024 * 1024;
export async function processarFoto(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Selecione uma imagem JPG, PNG ou WEBP.');
  if (buffer.length > MAX_FOTO_BYTES) throw new Error('Arquivo acima do tamanho permitido de 10 MB.');
  const input = sharp(buffer, { limitInputPixels: 80_000_000, failOn: 'warning' });
  let metadata;
  try { metadata = await input.metadata(); } catch {
    throw new Error('Imagem inválida ou dimensões acima do limite de 80 megapixels.');
  }
  if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Formato não permitido. Use JPG, PNG ou WEBP.');
  if ((metadata.pages || 1) > 1) throw new Error('Imagens animadas não são permitidas.');
  if (metadata.width > 16000 || metadata.height > 16000) throw new Error('A imagem deve ter no máximo 16000 pixels por lado.');
  // Auto-orient before resizing; Sharp strips EXIF (including GPS) by default.
  const { data: imagem, info } = await input.rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90, effort: 4 }).toBuffer({ resolveWithObject: true });
  const miniatura = await sharp(imagem).resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  return { imagem, miniatura, largura: info.width, altura: info.height, bytes: imagem.length };
}

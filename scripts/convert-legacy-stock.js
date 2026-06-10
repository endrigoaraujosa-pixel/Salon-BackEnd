import { sequelize } from '../src/config/db.js';
import { QueryTypes } from 'sequelize';

export async function convertLegacyStock() {
  try {
    const dialect = sequelize.getDialect();
    console.log(`[STOCK MIGRATION] Starting stock migration. Dialect: ${dialect}`);

    let schemas = [];
    if (dialect === 'postgres') {
      const res = await sequelize.query(
        `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'company_%'`,
        { type: QueryTypes.SELECT }
      );
      schemas = res.map(r => r.nspname);
    } else {
      // Fallback for sqlite / mysql if used in tests
      schemas = ['public'];
    }

    console.log(`[STOCK MIGRATION] Found ${schemas.length} schemas to process.`);

    for (const schema of schemas) {
      console.log(`[STOCK MIGRATION] Processing schema: ${schema}`);

      if (dialect === 'postgres') {
        // Add column if it doesn't exist
        await sequelize.query(
          `ALTER TABLE "${schema}"."produtos" ADD COLUMN IF NOT EXISTS "estoque_convertido" BOOLEAN DEFAULT FALSE;`,
          { type: QueryTypes.RAW }
        );

        // Fetch products to convert
        const products = await sequelize.query(
          `SELECT id, nome, quantidade_estoque, quantidade_por_unidade FROM "${schema}"."produtos" 
           WHERE "quantidade_por_unidade" > 0 AND ("estoque_convertido" = FALSE OR "estoque_convertido" IS NULL)`,
          { type: QueryTypes.SELECT }
        );

        for (const prod of products) {
          const qtyPorUnidade = parseFloat(prod.quantidade_por_unidade);
          const qtyEstoque = parseFloat(prod.quantidade_estoque || 0);

          if (qtyPorUnidade > 0 && qtyEstoque > 0) {
            const newQty = Number((qtyEstoque * qtyPorUnidade).toFixed(3));
            console.log(`[STOCK MIGRATION] Converting "${prod.nome}" in schema ${schema}: ${qtyEstoque} -> ${newQty}`);
            
            await sequelize.query(
              `UPDATE "${schema}"."produtos" SET "quantidade_estoque" = ?, "estoque_convertido" = TRUE WHERE id = ?`,
              { replacements: [newQty, prod.id], type: QueryTypes.UPDATE }
            );
          } else {
            // Just mark as converted if stock is 0 or negative
            await sequelize.query(
              `UPDATE "${schema}"."produtos" SET "estoque_convertido" = TRUE WHERE id = ?`,
              { replacements: [prod.id], type: QueryTypes.UPDATE }
            );
          }
        }
      } else {
        // Fallback execution for sqlite/mysql in tests
        try {
          await sequelize.query(
            `ALTER TABLE "produtos" ADD COLUMN "estoque_convertido" BOOLEAN DEFAULT FALSE;`,
            { type: QueryTypes.RAW }
          );
        } catch (e) {
          // column might already exist
        }

        const products = await sequelize.query(
          `SELECT id, nome, quantidade_estoque, quantidade_por_unidade FROM "produtos" 
           WHERE "quantidade_por_unidade" > 0 AND ("estoque_convertido" = FALSE OR "estoque_convertido" IS NULL)`,
          { type: QueryTypes.SELECT }
        );

        for (const prod of products) {
          const qtyPorUnidade = parseFloat(prod.quantidade_por_unidade);
          const qtyEstoque = parseFloat(prod.quantidade_estoque || 0);

          if (qtyPorUnidade > 0 && qtyEstoque > 0) {
            const newQty = Number((qtyEstoque * qtyPorUnidade).toFixed(3));
            await sequelize.query(
              `UPDATE "produtos" SET "quantidade_estoque" = ?, "estoque_convertido" = TRUE WHERE id = ?`,
              { replacements: [newQty, prod.id], type: QueryTypes.UPDATE }
            );
          } else {
            await sequelize.query(
              `UPDATE "produtos" SET "estoque_convertido" = TRUE WHERE id = ?`,
              { replacements: [prod.id], type: QueryTypes.UPDATE }
            );
          }
        }
      }
    }
    console.log('[STOCK MIGRATION] Finished successfully.');
  } catch (error) {
    console.error('[STOCK MIGRATION] Error during stock migration:', error);
  }
}

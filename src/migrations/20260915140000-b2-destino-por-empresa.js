export default {
  async up(q, S) {
    const schema = q.sequelize.options.schema;
    const config = { schema, tableName: 'configuracao_sistema' };
    const fotos = { schema, tableName: 'atendimento_fotos' };
    await q.sequelize.transaction(async transaction => {
      await q.addColumn(config, 'b2_bucket', { type: S.STRING(63), allowNull: true }, { transaction });
      await q.addColumn(config, 'b2_endpoint', { type: S.STRING(255), allowNull: true }, { transaction });
      await q.addColumn(config, 'b2_region', { type: S.STRING(40), allowNull: true }, { transaction });
      await q.addColumn(fotos, 'b2_destino', { type: S.JSON, allowNull: true }, { transaction });
      // Apenas compatibilidade com o destino usado pela versão anterior.
      const destination = { bucket: process.env.B2_BUCKET_NAME || 'salon-fotos-api',
        endpoint: process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com',
        region: process.env.B2_REGION || 'us-east-005' };
      const table = q.queryGenerator.quoteTable(fotos);
      await q.sequelize.query(`UPDATE ${table} SET b2_destino = :destination WHERE b2_imagem_key IS NOT NULL OR b2_miniatura_key IS NOT NULL`,
        { replacements: { destination: JSON.stringify(destination) }, transaction });
      const configTable = q.queryGenerator.quoteTable(config);
      await q.sequelize.query(`UPDATE ${configTable} SET b2_bucket = :bucket, b2_endpoint = :endpoint, b2_region = :region WHERE b2_key_id IS NOT NULL`,
        { replacements: destination, transaction });
    });
  },
  async down() { throw new Error('Não remover destinos de fotos já armazenadas em diferentes buckets.'); }
};

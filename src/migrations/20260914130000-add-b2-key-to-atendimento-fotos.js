/**
 * Migration: adiciona colunas b2_imagem_key e b2_miniatura_key
 * na tabela atendimento_fotos para armazenar a chave do objeto no B2.
 *
 * As colunas imagem e miniatura (BLOB) são mantidas para compatibilidade
 * retroativa com fotos já existentes. Serão removidas numa migration futura
 * após a migração completa dos dados para o B2.
 */
export default {
  async up(q, S) {
    const schema = q.sequelize.options.schema;
    await q.addColumn({ schema, tableName: 'atendimento_fotos' }, 'b2_imagem_key', {
      type: S.STRING(255), allowNull: true
    });
    await q.addColumn({ schema, tableName: 'atendimento_fotos' }, 'b2_miniatura_key', {
      type: S.STRING(255), allowNull: true
    });
  },
  async down(q) {
    const schema = q.sequelize.options.schema;
    await q.removeColumn({ schema, tableName: 'atendimento_fotos' }, 'b2_miniatura_key');
    await q.removeColumn({ schema, tableName: 'atendimento_fotos' }, 'b2_imagem_key');
  }
};

export default {
  async up(q, S) {
    await q.addColumn({ schema: q.sequelize.options.schema, tableName: 'configuracao_sistema' },
      'b2_key_name', { type: S.STRING(100), allowNull: true });
  },
  async down(q) {
    await q.removeColumn({ schema: q.sequelize.options.schema, tableName: 'configuracao_sistema' }, 'b2_key_name');
  }
};

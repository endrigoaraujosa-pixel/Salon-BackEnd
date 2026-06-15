export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'movimentacoes_estoque' },
      'usuario_id',
      {
        type: Sequelize.STRING(36),
        allowNull: true,
        defaultValue: null
      }
    );
    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'movimentacoes_estoque' },
      'usuario_nome',
      {
        type: Sequelize.STRING(255),
        allowNull: true,
        defaultValue: null
      }
    );
  },

  async down(queryInterface) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'movimentacoes_estoque' },
      'usuario_id'
    );
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'movimentacoes_estoque' },
      'usuario_nome'
    );
  }
};

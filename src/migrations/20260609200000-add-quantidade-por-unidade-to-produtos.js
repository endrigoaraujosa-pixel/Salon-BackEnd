export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'produtos' },
      'quantidade_por_unidade',
      {
        type: Sequelize.DECIMAL(15, 3),
        defaultValue: 0,
        allowNull: false
      }
    );
  },

  async down(queryInterface) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'produtos' },
      'quantidade_por_unidade'
    );
  }
};

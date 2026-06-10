export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'produtos' },
      'unidade_medida_insumo',
      {
        type: Sequelize.STRING(10),
        defaultValue: 'un',
        allowNull: false
      }
    );
  },

  async down(queryInterface) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'produtos' },
      'unidade_medida_insumo'
    );
  }
};

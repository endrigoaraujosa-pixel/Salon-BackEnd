export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'configuracao_sistema' },
      'permitir_alterar_preco_produto_venda',
      {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      }
    );
  },

  async down(queryInterface) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'configuracao_sistema' },
      'permitir_alterar_preco_produto_venda'
    );
  }
};

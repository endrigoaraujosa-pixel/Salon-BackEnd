export default {
  async up(queryInterface, Sequelize) {
    const schema_name = queryInterface.sequelize.options.schema;
    const configuracaoTable = { tableName: 'configuracao_sistema', schema: schema_name };
    const configuracaoTableInfo = await queryInterface.describeTable(configuracaoTable).catch(() => null);

    if (configuracaoTableInfo && !configuracaoTableInfo.ocultar_valores_online) {
      await queryInterface.addColumn(configuracaoTable, 'ocultar_valores_online', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    const configuracaoTable = { tableName: 'configuracao_sistema', schema: currentSchema };
    await queryInterface.removeColumn(configuracaoTable, 'ocultar_valores_online').catch(() => null);
  }
};

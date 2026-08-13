export default {
  async up(queryInterface, Sequelize) {
    const schema_name = queryInterface.sequelize.options.schema;
    const configuracaoTable = { tableName: 'configuracao_sistema', schema: schema_name };
    const configuracaoTableInfo = await queryInterface.describeTable(configuracaoTable).catch(() => null);

    if (configuracaoTableInfo && !configuracaoTableInfo.max_agendamentos_online_futuros) {
      await queryInterface.addColumn(configuracaoTable, 'max_agendamentos_online_futuros', {
        type: Sequelize.INTEGER,
        defaultValue: null,
        allowNull: true
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    const configuracaoTable = { tableName: 'configuracao_sistema', schema: currentSchema };
    await queryInterface.removeColumn(configuracaoTable, 'max_agendamentos_online_futuros').catch(() => null);
  }
};

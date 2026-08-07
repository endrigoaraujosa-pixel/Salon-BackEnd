export default {
  async up(queryInterface, Sequelize) {
    const schema_name = queryInterface.sequelize.options.schema;
    const configuracaoTable = { tableName: 'configuracao_sistema', schema: schema_name };
    const configuracaoTableInfo = await queryInterface.describeTable(configuracaoTable).catch(() => null);

    if (configuracaoTableInfo && !configuracaoTableInfo.aceitar_agendamento_online_automatico) {
      await queryInterface.addColumn(configuracaoTable, 'aceitar_agendamento_online_automatico', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    const configuracaoTable = { tableName: 'configuracao_sistema', schema: currentSchema };
    await queryInterface.removeColumn(configuracaoTable, 'aceitar_agendamento_online_automatico').catch(() => null);
  }
};

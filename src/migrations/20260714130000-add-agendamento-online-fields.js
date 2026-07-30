export default {

  async up(queryInterface, Sequelize) {
    const schema_name = queryInterface.sequelize.options.schema;
    // Adicionar em configuracao_sistema
    const configuracaoTable = { tableName: 'configuracao_sistema', schema: schema_name };
    const configuracaoTableInfo = await queryInterface.describeTable(configuracaoTable).catch(() => null);

    if (configuracaoTableInfo && !configuracaoTableInfo.agendamento_online_ativo) {
      await queryInterface.addColumn(configuracaoTable, 'agendamento_online_ativo', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      });
    }

    // Adicionar em servicos
    const servicosTable = { tableName: 'servicos', schema: schema_name };
    const servicosTableInfo = await queryInterface.describeTable(servicosTable).catch(() => null);

    if (servicosTableInfo && !servicosTableInfo.disponivel_online) {
      await queryInterface.addColumn(servicosTable, 'disponivel_online', {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      });
    }

  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    const configuracaoTable = { tableName: 'configuracao_sistema', schema: currentSchema };
    await queryInterface.removeColumn(configuracaoTable, 'agendamento_online_ativo').catch(() => null);

    const servicosTable = { tableName: 'servicos', schema: currentSchema };
    await queryInterface.removeColumn(servicosTable, 'disponivel_online').catch(() => null);

  }
}

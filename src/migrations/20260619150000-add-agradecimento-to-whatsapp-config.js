export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    const tableName = { schema: currentSchema, tableName: 'whatsapp_config' };

    await queryInterface.addColumn(tableName, 'agradecimento_ativo', {
      type: Sequelize.INTEGER,
      defaultValue: 0
    });

    await queryInterface.addColumn(tableName, 'agradecimento_tempo_minutos', {
      type: Sequelize.INTEGER,
      defaultValue: 30
    });

    await queryInterface.addColumn(tableName, 'agradecimento_modelo_mensagem', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    const tableName = { schema: currentSchema, tableName: 'whatsapp_config' };

    await queryInterface.removeColumn(tableName, 'agradecimento_ativo');
    await queryInterface.removeColumn(tableName, 'agradecimento_tempo_minutos');
    await queryInterface.removeColumn(tableName, 'agradecimento_modelo_mensagem');
  }
};

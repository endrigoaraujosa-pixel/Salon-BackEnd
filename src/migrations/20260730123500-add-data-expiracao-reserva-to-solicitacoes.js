export default {
  async up(queryInterface, Sequelize) {
    const schema_name = queryInterface.sequelize.options.schema;
    await queryInterface.addColumn(
      { tableName: 'agendamento_online_solicitacoes', schema: schema_name },
      'data_expiracao_reserva',
      {
        type: Sequelize.DATE,
        allowNull: true
      }
    );
  },

  async down(queryInterface, Sequelize) {
    const schema_name = queryInterface.sequelize.options.schema;
    await queryInterface.removeColumn(
      { tableName: 'agendamento_online_solicitacoes', schema: schema_name },
      'data_expiracao_reserva'
    );
  }
};

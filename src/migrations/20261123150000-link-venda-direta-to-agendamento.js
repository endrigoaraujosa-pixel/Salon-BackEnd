export default {
  async up(queryInterface, Sequelize) {
    const table = {
      schema: queryInterface.sequelize.options.schema,
      tableName: 'vendas_diretas'
    };

    await queryInterface.addColumn(table, 'agendamento_id', {
      type: Sequelize.STRING(36),
      allowNull: true
    });

    await queryInterface.addIndex(table, ['agendamento_id'], {
      name: 'idx_vendas_diretas_agendamento_id'
    });
  },

  async down(queryInterface) {
    const table = {
      schema: queryInterface.sequelize.options.schema,
      tableName: 'vendas_diretas'
    };

    await queryInterface.removeIndex(table, 'idx_vendas_diretas_agendamento_id');
    await queryInterface.removeColumn(table, 'agendamento_id');
  }
};

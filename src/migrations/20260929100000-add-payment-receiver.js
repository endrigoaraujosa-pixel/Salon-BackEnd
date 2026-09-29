export default {
  async up(queryInterface, Sequelize) {
    const table = { schema: queryInterface.sequelize.options.schema, tableName: 'pagamentos' };
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.addColumn(table, 'recebido_por_id', {
        type: Sequelize.STRING(36),
        allowNull: true
      }, { transaction });
      await queryInterface.addColumn(table, 'recebido_por_nome', {
        type: Sequelize.STRING(255),
        allowNull: true
      }, { transaction });
    });
  },

  async down(queryInterface) {
    const table = { schema: queryInterface.sequelize.options.schema, tableName: 'pagamentos' };
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.removeColumn(table, 'recebido_por_nome', { transaction });
      await queryInterface.removeColumn(table, 'recebido_por_id', { transaction });
    });
  }
};

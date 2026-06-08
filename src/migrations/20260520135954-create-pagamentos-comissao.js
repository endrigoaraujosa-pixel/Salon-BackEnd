export default {
  async up (queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({schema: currentSchema, tableName: 'pagamentos_comissao'}, {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      colaborador_id: {
        type: Sequelize.STRING(36),
        allowNull: false
      },
      periodo: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      valor: {
        type: Sequelize.FLOAT,
        allowNull: false
      },
      data_pagamento: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('pagamentos_comissao');
  }
};

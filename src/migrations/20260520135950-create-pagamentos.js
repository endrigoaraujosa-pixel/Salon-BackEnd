export default {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('pagamentos', {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      agendamento_id: {
        type: Sequelize.STRING(36),
        allowNull: true
      },
      venda_direta_id: {
        type: Sequelize.STRING(36),
        allowNull: true
      },
      valor: {
        type: Sequelize.FLOAT,
        allowNull: false
      },
      forma_pagamento: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      observacao: {
        type: Sequelize.TEXT,
        defaultValue: ''
      },
      data_hora: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('pagamentos');
  }
};

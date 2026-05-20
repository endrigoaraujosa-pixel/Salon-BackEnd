export default {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('taxas_cartao', {
      forma_pagamento: {
        type: Sequelize.STRING(50),
        primaryKey: true,
        allowNull: false
      },
      percentual: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('taxas_cartao');
  }
};

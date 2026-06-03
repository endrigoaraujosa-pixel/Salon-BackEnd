export default {
  async up (queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({schema: currentSchema, tableName: 'despesas'}, {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      descricao: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      valor: {
        type: Sequelize.FLOAT,
        allowNull: false,
        defaultValue: 0
      },
      tipo: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'fixo'
      },
      categoria: {
        type: Sequelize.STRING(255),
        defaultValue: ''
      },
      data_vencimento: {
        type: Sequelize.STRING(50),
        defaultValue: ''
      },
      data_pagamento: {
        type: Sequelize.STRING(50),
        defaultValue: ''
      },
      pago: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      observacoes: {
        type: Sequelize.TEXT,
        defaultValue: ''
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('despesas');
  }
};

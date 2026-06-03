export default {
  async up (queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({schema: currentSchema, tableName: 'outras_receitas'}, {
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
      categoria: {
        type: Sequelize.STRING(255),
        defaultValue: ''
      },
      data_recebimento: {
        type: Sequelize.STRING(50),
        defaultValue: ''
      },
      observacoes: {
        type: Sequelize.TEXT,
        defaultValue: ''
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('outras_receitas');
  }
};

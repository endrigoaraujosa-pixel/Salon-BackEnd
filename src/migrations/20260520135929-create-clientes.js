export default {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('clientes', {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      nome: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      telefone: {
        type: Sequelize.STRING(50),
        defaultValue: ''
      },
      email: {
        type: Sequelize.STRING(255),
        defaultValue: ''
      },
      data_nascimento: {
        type: Sequelize.STRING(20),
        defaultValue: ''
      },
      endereco: {
        type: Sequelize.TEXT,
        defaultValue: ''
      },
      observacoes: {
        type: Sequelize.TEXT,
        defaultValue: ''
      },
      criado_em: {
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
    await queryInterface.dropTable('clientes');
  }
};

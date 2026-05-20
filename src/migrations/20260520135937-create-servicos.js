export default {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('servicos', {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      nome: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      duracao_minutos: {
        type: Sequelize.INTEGER,
        defaultValue: 60
      },
      valor: {
        type: Sequelize.FLOAT,
        allowNull: false
      },
      descricao: {
        type: Sequelize.TEXT,
        defaultValue: ''
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      produtos_vinculados: {
        type: Sequelize.TEXT,
        defaultValue: '[]'
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
    await queryInterface.dropTable('servicos');
  }
};

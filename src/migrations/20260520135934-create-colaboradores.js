export default {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('colaboradores', {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      nome: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      cargo: {
        type: Sequelize.STRING(255),
        defaultValue: ''
      },
      telefone: {
        type: Sequelize.STRING(50),
        defaultValue: ''
      },
      comissao_principal: {
        type: Sequelize.FLOAT,
        defaultValue: 40
      },
      comissao_auxiliar: {
        type: Sequelize.FLOAT,
        defaultValue: 20
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
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
    await queryInterface.dropTable('colaboradores');
  }
};

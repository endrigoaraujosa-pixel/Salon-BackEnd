export default {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('agendamentos', {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      numero: {
        type: Sequelize.INTEGER,
        defaultValue: null
      },
      cliente_id: {
        type: Sequelize.STRING(36),
        allowNull: false
      },
      cliente_nome: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      data_hora: {
        type: Sequelize.DATE,
        allowNull: false
      },
      itens: {
        type: Sequelize.JSON,
        defaultValue: '[]'
      },
      profissionais: {
        type: Sequelize.JSON,
        defaultValue: '[]'
      },
      observacoes: {
        type: Sequelize.TEXT,
        defaultValue: ''
      },
      valor_total: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      duracao_minutos: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      status: {
        type: Sequelize.STRING(50),
        defaultValue: 'agendado'
      },
      valor_pago: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      alterado_por_id: {
        type: Sequelize.STRING(36),
        defaultValue: null
      },
      alterado_em: {
        type: Sequelize.DATE,
        defaultValue: null
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
    await queryInterface.dropTable('agendamentos');
  }
};

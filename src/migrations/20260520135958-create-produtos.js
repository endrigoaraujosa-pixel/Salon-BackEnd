export default {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('produtos', {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      nome: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      categoria: {
        type: Sequelize.STRING(255),
        defaultValue: ''
      },
      unidade_medida: {
        type: Sequelize.STRING(50),
        defaultValue: 'un'
      },
      quantidade_estoque: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      estoque_minimo: {
        type: Sequelize.FLOAT,
        defaultValue: 5
      },
      custo_unitario: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      preco_venda: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      fornecedor: {
        type: Sequelize.STRING(255),
        defaultValue: ''
      },
      ativo: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
      },
      comissao: {
        type: Sequelize.DECIMAL(10, 4),
        defaultValue: 0
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
    await queryInterface.dropTable('produtos');
  }
};

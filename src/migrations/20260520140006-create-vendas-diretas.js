export default {
  async up (queryInterface, Sequelize) {
     const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.createTable({schema: currentSchema, tableName: 'vendas_diretas'}, {
      id: {
        type: Sequelize.STRING(36),
        primaryKey: true,
        allowNull: false
      },
      data_venda: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      produto_id: {
        type: Sequelize.STRING(36),
        allowNull: false
      },
      produto_nome: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      quantidade: {
        type: Sequelize.FLOAT,
        allowNull: false
      },
      colaborador_id: {
        type: Sequelize.STRING(36),
        allowNull: true
      },
      colaborador_nome: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      cliente_id: {
        type: Sequelize.STRING(36),
        allowNull: true
      },
      cliente_nome: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      valor_total: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      valor_pago: {
        type: Sequelize.FLOAT,
        defaultValue: 0
      },
      status: {
        type: Sequelize.STRING(50),
        defaultValue: 'pendente'
      },
      comissao_paga: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      }
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('vendas_diretas');
  }
};

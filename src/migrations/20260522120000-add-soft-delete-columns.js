export default {
  async up(queryInterface, Sequelize) {
    const tables = [
      'users',
      'clientes',
      'colaboradores',
      'servicos',
      'despesas',
      'outras_receitas',
      'produtos',
      'agendamentos',
      'pagamentos',
      'categorias',
    ];

    // Add soft delete columns to all tables
    for (const table of tables) {
      await queryInterface.addColumn(table, 'deletado', {
        type: Sequelize.STRING(1),
        defaultValue: 'N',
        allowNull: false
      });

      await queryInterface.addColumn(table, 'deletado_por', {
        type: Sequelize.STRING(255),
        allowNull: true
      });

      await queryInterface.addColumn(table, 'deletado_em', {
        type: Sequelize.DATE,
        allowNull: true
      });

    }


    await queryInterface.addColumn('vendas_diretas', 'numero_venda', {
      type: Sequelize.INTEGER,
      defaultValue: null,
      allowNull: true
    });

    await queryInterface.addColumn('vendas_diretas', 'itens', {
      type: Sequelize.JSON,
      defaultValue: null,
      allowNull: true
    });

  },

  async down(queryInterface, Sequelize) {
    const tables = [
      'users',
      'clientes',
      'colaboradores',
      'servicos',
      'despesas',
      'outras_receitas',
      'produtos',
      'agendamentos',
      'pagamentos',
      'categorias',
    ];

    for (const table of tables) {
      await queryInterface.removeColumn(table, 'deletado');
      await queryInterface.removeColumn(table, 'deletado_por');
      await queryInterface.removeColumn(table, 'deletado_em');
    }

    await queryInterface.removeColumn('vendas_diretas', 'numero_venda');
    await queryInterface.removeColumn('vendas_diretas', 'itens');
  }
};

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
      const tableDesc = await queryInterface.describeTable(table);

      if (!tableDesc.deletado) {
        await queryInterface.addColumn(table, 'deletado', {
          type: Sequelize.STRING(1),
          defaultValue: 'N',
          allowNull: false
        });
      }

      if (!tableDesc.deletado_por) {
        await queryInterface.addColumn(table, 'deletado_por', {
          type: Sequelize.STRING(255),
          allowNull: true
        });
      }

      if (!tableDesc.deletado_em) {
        await queryInterface.addColumn(table, 'deletado_em', {
          type: Sequelize.DATE,
          allowNull: true
        });
      }
    }

    // Add numero_venda to vendas_diretas
    const vendasDesc = await queryInterface.describeTable('vendas_diretas');

    if (!vendasDesc.numero_venda) {
      await queryInterface.addColumn('vendas_diretas', 'numero_venda', {
        type: Sequelize.INTEGER,
        defaultValue: null,
        allowNull: true
      });
    }

    if (!vendasDesc.itens) {
      await queryInterface.addColumn('vendas_diretas', 'itens', {
        type: Sequelize.JSON,
        defaultValue: null,
        allowNull: true
      });
    }
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

'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = [
      'vendas_diretas',
      'taxas_cartao',
      'pagamentos_comissao'
    ];

    // Add soft delete columns to all tables
    for (const table of tables) {
      const tableDesc = await queryInterface.describeTable(table);
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
  },

  async down(queryInterface, Sequelize) {
    const tables = [
      'vendas_diretas',
      'taxas_cartao',
      'pagamentos_comissao'
    ];

    for (const table of tables) {
      await queryInterface.removeColumn(table, 'deletado');
      await queryInterface.removeColumn(table, 'deletado_por');
      await queryInterface.removeColumn(table, 'deletado_em');
    }
  }
};

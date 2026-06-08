export default {
  async up(queryInterface, Sequelize) {
    const table = 'despesas';

    await queryInterface.addColumn(table, 'data_documento', {
      type: Sequelize.STRING(50),
      defaultValue: ''
    });

    await queryInterface.addColumn(table, 'status', {
      type: Sequelize.STRING(50),
      defaultValue: 'Aberto'
    });

    await queryInterface.addColumn(table, 'numero_documento', {
      type: Sequelize.STRING(100),
      defaultValue: ''
    });

    await queryInterface.addColumn(table, 'fornecedor', {
      type: Sequelize.STRING(255),
      defaultValue: ''
    });

    await queryInterface.addColumn(table, 'baixado_por', {
      type: Sequelize.STRING(255),
      allowNull: true
    });

    await queryInterface.addColumn(table, 'baixado_em', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    const table = 'despesas';
    const columns = ['data_documento', 'status', 'numero_documento', 'fornecedor', 'baixado_por', 'baixado_em'];
    for (const col of columns) {
      try {
        await queryInterface.removeColumn(table, col);
      } catch (err) {
        // Ignore if already removed
      }
    }
  }
};

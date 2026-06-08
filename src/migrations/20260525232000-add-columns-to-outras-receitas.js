export default {
  async up(queryInterface, Sequelize) {
    const table = 'outras_receitas';

    await queryInterface.addColumn(table, 'status', {
      type: Sequelize.STRING(50),
      defaultValue: 'Aberto'
    });


    await queryInterface.addColumn(table, 'numero_documento', {
      type: Sequelize.STRING(100),
      defaultValue: ''
    });

    await queryInterface.addColumn(table, 'cliente', {
      type: Sequelize.STRING(255),
      defaultValue: ''
    });

    await queryInterface.addColumn(table, 'data_documento', {
      type: Sequelize.STRING(50),
      defaultValue: ''
    });

    await queryInterface.addColumn(table, 'data_vencimento', {
      type: Sequelize.STRING(50),
      defaultValue: ''
    });

    await queryInterface.addColumn(table, 'recebido', {
      type: Sequelize.BOOLEAN,
      defaultValue: false
    });

    await queryInterface.addColumn(table, 'forma_pagamento', {
      type: Sequelize.STRING(100),
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
    const table = 'outras_receitas';
    const columns = ['status', 'numero_documento', 'cliente', 'data_documento', 'data_vencimento', 'recebido', 'forma_pagamento', 'baixado_por', 'baixado_em'];
    for (const col of columns) {
      await queryInterface.removeColumn(table, col);
    }
  }
};

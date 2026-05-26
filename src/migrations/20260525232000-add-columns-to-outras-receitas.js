export default {
  async up(queryInterface, Sequelize) {
    const table = 'outras_receitas';
    const tableDesc = await queryInterface.describeTable(table);

    if (!tableDesc.status) {
      await queryInterface.addColumn(table, 'status', {
        type: Sequelize.STRING(50),
        defaultValue: 'Aberto'
      });
    }
    if (!tableDesc.numero_documento) {
      await queryInterface.addColumn(table, 'numero_documento', {
        type: Sequelize.STRING(100),
        defaultValue: ''
      });
    }
    if (!tableDesc.cliente) {
      await queryInterface.addColumn(table, 'cliente', {
        type: Sequelize.STRING(255),
        defaultValue: ''
      });
    }
    if (!tableDesc.data_documento) {
      await queryInterface.addColumn(table, 'data_documento', {
        type: Sequelize.STRING(50),
        defaultValue: ''
      });
    }
    if (!tableDesc.data_vencimento) {
      await queryInterface.addColumn(table, 'data_vencimento', {
        type: Sequelize.STRING(50),
        defaultValue: ''
      });
    }
    if (!tableDesc.recebido) {
      await queryInterface.addColumn(table, 'recebido', {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      });
    }
    if (!tableDesc.forma_pagamento) {
      await queryInterface.addColumn(table, 'forma_pagamento', {
        type: Sequelize.STRING(100),
        defaultValue: ''
      });
    }
    if (!tableDesc.baixado_por) {
      await queryInterface.addColumn(table, 'baixado_por', {
        type: Sequelize.STRING(255),
        allowNull: true
      });
    }
    if (!tableDesc.baixado_em) {
      await queryInterface.addColumn(table, 'baixado_em', {
        type: Sequelize.DATE,
        allowNull: true
      });
    }
  },

  async down(queryInterface, Sequelize) {
    const table = 'outras_receitas';
    const columns = ['status', 'numero_documento', 'cliente', 'data_documento', 'data_vencimento', 'recebido', 'forma_pagamento', 'baixado_por', 'baixado_em'];
    for (const col of columns) {
      try {
        await queryInterface.removeColumn(table, col);
      } catch (err) {
        // Ignore if already removed
      }
    }
  }
};

export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;

    // 1. Add columns to entradas_estoque
    const entradaTableInfo = await queryInterface.describeTable({ schema: currentSchema, tableName: 'entradas_estoque' }).catch(() => null);

    if (entradaTableInfo) {
      if (!entradaTableInfo.natureza_operacao) {
        await queryInterface.addColumn(
          { schema: currentSchema, tableName: 'entradas_estoque' },
          'natureza_operacao',
          {
            type: Sequelize.STRING(50),
            allowNull: false,
            defaultValue: 'compra_prazo'
          }
        );
      }

      if (!entradaTableInfo.gerar_financeiro) {
        await queryInterface.addColumn(
          { schema: currentSchema, tableName: 'entradas_estoque' },
          'gerar_financeiro',
          {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true
          }
        );
      }

      if (!entradaTableInfo.condicao_pagamento) {
        await queryInterface.addColumn(
          { schema: currentSchema, tableName: 'entradas_estoque' },
          'condicao_pagamento',
          {
            type: Sequelize.STRING(50),
            allowNull: true,
            defaultValue: 'avista'
          }
        );
      }

      if (!entradaTableInfo.qtd_parcelas) {
        await queryInterface.addColumn(
          { schema: currentSchema, tableName: 'entradas_estoque' },
          'qtd_parcelas',
          {
            type: Sequelize.INTEGER,
            allowNull: true,
            defaultValue: 1
          }
        );
      }
    }

    // 2. Add entrada_estoque_id column to despesas
    const despesaTableInfo = await queryInterface.describeTable({ schema: currentSchema, tableName: 'despesas' }).catch(() => null);

    if (despesaTableInfo && !despesaTableInfo.entrada_estoque_id) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'despesas' },
        'entrada_estoque_id',
        {
          type: Sequelize.STRING(36),
          allowNull: true,
          defaultValue: null
        }
      );
    }
  },

  async down(queryInterface) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'entradas_estoque' },
      'natureza_operacao'
    ).catch(() => null);
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'entradas_estoque' },
      'gerar_financeiro'
    ).catch(() => null);
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'entradas_estoque' },
      'condicao_pagamento'
    ).catch(() => null);
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'entradas_estoque' },
      'qtd_parcelas'
    ).catch(() => null);
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'despesas' },
      'entrada_estoque_id'
    ).catch(() => null);
  }
};

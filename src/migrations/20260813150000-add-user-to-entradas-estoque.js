export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    const tableInfo = await queryInterface.describeTable({ schema: currentSchema, tableName: 'entradas_estoque' }).catch(() => null);

    if (tableInfo && !tableInfo.usuario_id) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'entradas_estoque' },
        'usuario_id',
        {
          type: Sequelize.STRING(36),
          allowNull: true,
          defaultValue: null
        }
      );
    }

    if (tableInfo && !tableInfo.usuario_nome) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'entradas_estoque' },
        'usuario_nome',
        {
          type: Sequelize.STRING(255),
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
      'usuario_id'
    ).catch(() => null);
    await queryInterface.removeColumn(
      { schema: currentSchema, tableName: 'entradas_estoque' },
      'usuario_nome'
    ).catch(() => null);
  }
};

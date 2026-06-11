export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    
    // Check if the column already exists before adding it
    const tableInfo = await queryInterface.describeTable({ schema: currentSchema, tableName: 'produtos' });
    if (!tableInfo.estoque_convertido) {
      await queryInterface.addColumn(
        { schema: currentSchema, tableName: 'produtos' },
        'estoque_convertido',
        {
          type: Sequelize.BOOLEAN,
          defaultValue: false,
          allowNull: true
        }
      );
    }
  },

  async down(queryInterface) {
    const currentSchema = queryInterface.sequelize.options.schema;
    
    // Check if the column exists before removing it
    const tableInfo = await queryInterface.describeTable({ schema: currentSchema, tableName: 'produtos' });
    if (tableInfo.estoque_convertido) {
      await queryInterface.removeColumn(
        { schema: currentSchema, tableName: 'produtos' },
        'estoque_convertido'
      );
    }
  }
};

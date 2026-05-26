export default {
  async up(queryInterface, Sequelize) {
    // 1. Add serie_nota column to entradas_estoque
    await queryInterface.addColumn('entradas_estoque', 'serie_nota', {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: ''
    });

    // 2. Add composite unique index for unique identification
    // combination of supplier, invoice number, and series
    await queryInterface.addIndex('entradas_estoque', ['fornecedor_id', 'numero_nota', 'serie_nota'], {
      unique: true,
      name: 'unique_supplier_invoice_series'
    });
  },

  async down(queryInterface, Sequelize) {
    // Remove index and column
    await queryInterface.removeIndex('entradas_estoque', 'unique_supplier_invoice_series');
    await queryInterface.removeColumn('entradas_estoque', 'serie_nota');
  }
};

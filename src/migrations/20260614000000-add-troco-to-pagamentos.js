export default {
  async up(queryInterface, Sequelize) {
    const table = 'pagamentos';
    
    try {
      await queryInterface.addColumn(table, 'valor_recebido', {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
        allowNull: false
      });
    } catch (e) {
      if (!e.message.includes('already exists')) throw e;
    }

    try {
      await queryInterface.addColumn(table, 'troco', {
        type: Sequelize.DECIMAL(10, 2),
        defaultValue: 0,
        allowNull: false
      });
    } catch (e) {
      if (!e.message.includes('already exists')) throw e;
    }

    const currentSchema = queryInterface.sequelize.options.schema;
    // Populate valor_recebido from valor for existing records
    await queryInterface.sequelize.query(
      `UPDATE "${currentSchema}"."pagamentos" SET valor_recebido = valor;`
    );
  },

  async down(queryInterface, Sequelize) {
    const table = 'pagamentos';
    await queryInterface.removeColumn(table, 'valor_recebido');
    await queryInterface.removeColumn(table, 'troco');
  }
};

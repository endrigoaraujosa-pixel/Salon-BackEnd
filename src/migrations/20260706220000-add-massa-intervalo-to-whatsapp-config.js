export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;

    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'whatsapp_config' },
      'massa_intervalo_min',
      { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 }
    );

    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'whatsapp_config' },
      'massa_intervalo_max',
      { type: Sequelize.INTEGER, allowNull: false, defaultValue: 8 }
    );
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.removeColumn({ schema: currentSchema, tableName: 'whatsapp_config' }, 'massa_intervalo_min');
    await queryInterface.removeColumn({ schema: currentSchema, tableName: 'whatsapp_config' }, 'massa_intervalo_max');
  }
};

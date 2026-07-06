export default {
  async up(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;

    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'whatsapp_campanhas' },
      'midia_base64',
      { type: Sequelize.TEXT, allowNull: true }
    );

    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'whatsapp_campanhas' },
      'midia_nome',
      { type: Sequelize.STRING(255), allowNull: true }
    );

    await queryInterface.addColumn(
      { schema: currentSchema, tableName: 'whatsapp_campanhas' },
      'midia_tipo',
      { type: Sequelize.STRING(50), allowNull: true }
    );
  },

  async down(queryInterface, Sequelize) {
    const currentSchema = queryInterface.sequelize.options.schema;
    await queryInterface.removeColumn({ schema: currentSchema, tableName: 'whatsapp_campanhas' }, 'midia_base64');
    await queryInterface.removeColumn({ schema: currentSchema, tableName: 'whatsapp_campanhas' }, 'midia_nome');
    await queryInterface.removeColumn({ schema: currentSchema, tableName: 'whatsapp_campanhas' }, 'midia_tipo');
  }
};

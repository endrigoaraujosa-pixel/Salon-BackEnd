export default {
  async up(queryInterface, Sequelize) {

    await queryInterface.addColumn('whatsapp_config', 'api_url', {
      type: Sequelize.STRING(500),
      allowNull: true
    });

    await queryInterface.addColumn('whatsapp_config', 'instancia', {
      type: Sequelize.STRING(255),
      allowNull: true
    });

    await queryInterface.addColumn('whatsapp_config', 'token', {
      type: Sequelize.STRING(500),
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('whatsapp_config', 'api_url');
    await queryInterface.removeColumn('whatsapp_config', 'instancia');
    await queryInterface.removeColumn('whatsapp_config', 'token');
  }
};

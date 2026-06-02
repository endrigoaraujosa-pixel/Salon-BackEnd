export default {
  async up(queryInterface, Sequelize) {
    const tableInfo = await queryInterface.describeTable('whatsapp_config');
    
    if (!tableInfo.api_url) {
      await queryInterface.addColumn('whatsapp_config', 'api_url', {
        type: Sequelize.STRING(500),
        allowNull: true
      });
    }
    
    if (!tableInfo.instancia) {
      await queryInterface.addColumn('whatsapp_config', 'instancia', {
        type: Sequelize.STRING(255),
        allowNull: true
      });
    }
    
    if (!tableInfo.token) {
      await queryInterface.addColumn('whatsapp_config', 'token', {
        type: Sequelize.STRING(500),
        allowNull: true
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('whatsapp_config', 'api_url');
    await queryInterface.removeColumn('whatsapp_config', 'instancia');
    await queryInterface.removeColumn('whatsapp_config', 'token');
  }
};

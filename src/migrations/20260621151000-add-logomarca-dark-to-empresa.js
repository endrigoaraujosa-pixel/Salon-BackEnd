export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('empresa', 'logomarca_dark', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('empresa', 'logomarca_dark');
  }
};

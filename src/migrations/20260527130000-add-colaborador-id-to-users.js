export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'colaborador_id', {
      type: Sequelize.STRING(36),
      allowNull: true
    });

  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'colaborador_id');
  }
};

export default {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('users');

    if (!tableDesc.colaborador_id) {
      await queryInterface.addColumn('users', 'colaborador_id', {
        type: Sequelize.STRING(36),
        allowNull: true
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('users', 'colaborador_id');
  }
};

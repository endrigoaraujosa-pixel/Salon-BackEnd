export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('clientes', 'foto', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null
    });
    await queryInterface.addColumn('colaboradores', 'foto', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('clientes', 'foto');
    await queryInterface.removeColumn('colaboradores', 'foto');
  }
};

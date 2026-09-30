export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn({
      schema: queryInterface.sequelize.options.schema,
      tableName: 'users'
    }, 'sexo', {
      type: Sequelize.STRING(10),
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn({
      schema: queryInterface.sequelize.options.schema,
      tableName: 'users'
    }, 'sexo');
  }
};
